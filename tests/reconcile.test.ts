import { describe, expect, test } from 'claude-code/testing'

import type { FeatureEvidence, FileEvidence } from '../hooks/detect'
import { initialStatus, isHealthy, reconcile, signalsOf } from '../hooks/reconcile'
import { type Feature, type Roadmap, blankFeature } from '../hooks/schema'

const NOW = '2026-10-12T12:00:00.000Z'
const NOW_MS = Date.parse(NOW)

function ev(fields: Partial<FeatureEvidence> = {}): FeatureEvidence {
  return {
    files: [file()],
    env_required: [],
    env_missing: [],
    env_source: 'Railway (production)',
    tests: ['src/a.test.ts'],
    tests_status: 'pass',
    last_change: '2026-09-01T00:00:00.000Z',
    recent_changes: 0,
    uncommitted: false,
    commits: [],
    ...fields,
  }
}

function file(fields: Partial<FileEvidence> = {}): FileEvidence {
  return { path: 'src/a.ts', exists: true, wired: true, screen: false, markers: 0, last_change: null, uncommitted: false, ...fields }
}

function feature(fields: Partial<Feature> = {}): Feature {
  return { ...blankFeature('a', 'A', '2026-10-01T00:00:00.000Z'), related_files: ['src/a.ts'], ...fields }
}

const roadmapOf = (features: Feature[]): Roadmap => ({
  schema_version: 2,
  project_id: null,
  name: 'P',
  last_touched: NOW,
  where_i_left_off: '',
  left_off_at: null,
  synced_at: null,
  synced_commit: null,
  milestones: [],
  features,
  recent_changes: [],
  decisions: [],
  progress_log: [],
  ignored_files: [],
})

describe('initial status', () => {
  test('from evidence alone', () => {
    expect(initialStatus(undefined, NOW_MS)).toBe('not_started')
    expect(initialStatus(ev({ files: [file({ path: 'src/a.ts', exists: false, wired: null, screen: false, markers: 0 })] }), NOW_MS)).toBe('not_started')
    expect(initialStatus(ev(), NOW_MS)).toBe('done')
    expect(initialStatus(ev({ tests_status: 'none', last_change: '2026-10-10T00:00:00.000Z' }), NOW_MS)).toBe('in_progress')
    // Shipped a while ago and never proved: done, and the sidebar says unverified.
    expect(initialStatus(ev({ tests_status: 'none' }), NOW_MS)).toBe('done')
  })

  test('healthy needs wiring, passing tests and its config', () => {
    expect(isHealthy(ev())).toBe(true)
    expect(isHealthy(ev({ tests_status: 'unknown' }))).toBe(false)
    expect(isHealthy(ev({ env_missing: ['KEY'] }))).toBe(false)
    expect(isHealthy(ev({ files: [file({ path: 'src/a.ts', exists: true, wired: false, screen: false, markers: 0 })] }))).toBe(false)
  })
})

describe('reconcile', () => {
  test('passing tests prove it working, and a reachable screen makes it designed', () => {
    const screen = ev({ files: [file({ path: 'app/a.tsx', exists: true, wired: true, screen: true, markers: 0 })] })
    const { roadmap, changes } = reconcile(roadmapOf([feature({ status: 'done', functional_state: 'partial' })]), { a: screen }, NOW)
    expect(roadmap.features[0]).toMatchObject({ ui_state: 'designed', functional_state: 'working', verified_by: 'tests' })
    expect(changes.map(change => `${change.field}:${change.to}:${change.source}`)).toEqual(['ui_state:designed:detected', 'functional_state:working:detected'])
    expect(roadmap.recent_changes[0]?.source).toBe('detected')
  })

  test('failing tests take working back; unknown never does', () => {
    const working = feature({ status: 'done', functional_state: 'working', verified_by: 'user' })
    expect(reconcile(roadmapOf([working]), { a: ev({ tests_status: 'fail' }) }, NOW).roadmap.features[0]).toMatchObject({ functional_state: 'partial', verified_by: null })
    expect(reconcile(roadmapOf([working]), { a: ev({ tests_status: 'unknown' }) }, NOW).changes).toEqual([])
  })

  test('missing config blocks it on the user, and lifts when the config appears', () => {
    const missing = ev({ env_required: ['STRIPE_KEY'], env_missing: ['STRIPE_KEY'], tests_status: 'none' })
    const blocked = reconcile(roadmapOf([feature({ status: 'done', functional_state: 'partial' })]), { a: missing }, NOW).roadmap
    expect(blocked.features[0]).toMatchObject({
      status: 'blocked',
      blocked_on: 'you',
      blocker_reason: 'Missing in Railway (production): STRIPE_KEY',
      auto_blocked: { from: 'done' },
    })
    const lifted = reconcile(blocked, { a: ev({ env_required: ['STRIPE_KEY'], tests_status: 'none' }) }, NOW).roadmap
    expect(lifted.features[0]).toMatchObject({ status: 'done', blocked_on: null, blocker_reason: null, auto_blocked: null })
  })

  test("a block Claude or the user set is never lifted by detection", () => {
    const judged = feature({ status: 'blocked', blocked_on: 'you', blocker_reason: 'Waiting on a design decision' })
    expect(reconcile(roadmapOf([judged]), { a: ev() }, NOW).roadmap.features[0]?.status).toBe('blocked')
  })

  test('planned work whose files started moving is in progress', () => {
    const planned = feature({ status: 'queued' })
    const moving = ev({ uncommitted: true, tests_status: 'none', files: [file({ uncommitted: true })] })
    expect(reconcile(roadmapOf([planned]), { a: moving }, NOW).roadmap.features[0]?.status).toBe('in_progress')
  })

  test('a file another feature shares does not start this one', () => {
    const planned = feature({ status: 'queued', related_files: ['src/a.ts', 'src/shared.ts'] })
    const other = { ...feature({ status: 'done' }), id: 'b', related_files: ['src/shared.ts'] }
    const shared = ev({ tests_status: 'none', files: [file(), file({ path: 'src/shared.ts', uncommitted: true })] })
    expect(reconcile(roadmapOf([planned, other]), { a: shared }, NOW).roadmap.features[0]?.status).toBe('queued')
  })

  test("a feature whose files are all another's gets nothing from their evidence", () => {
    const planned = feature({ status: 'not_started', related_files: ['src/home.tsx'] })
    const home = { ...feature({ status: 'done' }), id: 'home', related_files: ['src/home.tsx'] }
    const proven = ev({ files: [file({ path: 'src/home.tsx', uncommitted: true })] })
    expect(reconcile(roadmapOf([planned, home]), { a: proven }, NOW).changes).toEqual([])
  })

  test('a pinned feature is never changed, and parked keeps its status', () => {
    const pinned = feature({ status: 'queued', pinned: true })
    const moving = ev({ uncommitted: true, files: [file({ uncommitted: true })] })
    expect(reconcile(roadmapOf([pinned]), { a: moving }, NOW).changes).toEqual([])
    const parked = feature({ status: 'parked', parked_reason: 'waiting on design' })
    expect(reconcile(roadmapOf([parked]), { a: moving }, NOW).roadmap.features[0]?.status).toBe('parked')
  })

  test('a feature with no files is left alone', () => {
    const idea = { ...feature({ status: 'not_started' }), related_files: [] }
    expect(reconcile(roadmapOf([idea]), {}, NOW).changes).toEqual([])
  })

  test('signals, worst first', () => {
    const noisy = ev({
      env_missing: ['A', 'B', 'C'],
      tests_status: 'fail',
      files: [file({ path: 'src/a.ts', exists: true, wired: false, screen: false, markers: 3 })],
    })
    expect(signalsOf(noisy)).toEqual(['needs A, B…', 'tests failing', 'not wired in', '3 TODOs'])
  })
})

describe('regressions', () => {
  test('working taken away marks it broke, with why; working again clears it', () => {
    const working = feature({ status: 'done', functional_state: 'working', verified_by: 'tests' })
    const failing = reconcile(roadmapOf([working]), { a: ev({ tests_status: 'fail' }) }, NOW).roadmap.features[0] as Feature
    expect(failing).toMatchObject({ functional_state: 'partial', regressed: { at: NOW, reason: 'tests fail' }, progress_at: NOW })
    const unwired = reconcile(roadmapOf([working]), { a: ev({ files: [file({ wired: false })] }) }, NOW).roadmap.features[0] as Feature
    expect(unwired.regressed?.reason).toBe('a file is no longer wired in')
    const healed = reconcile(roadmapOf([failing]), { a: ev() }, NOW).roadmap.features[0] as Feature
    expect(healed).toMatchObject({ functional_state: 'working', regressed: null })
  })
})
