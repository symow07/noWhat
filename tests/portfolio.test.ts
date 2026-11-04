import { describe, expect, test } from 'claude-code/testing'

import { sortProjects, summarize } from '../hooks/portfolio'
import { type Feature, type Roadmap, blankFeature } from '../hooks/schema'

const NOW = '2026-10-12T12:00:00.000Z'
const NOW_MS = Date.parse(NOW)
const DAY = 86_400_000
const daysAgo = (days: number) => new Date(NOW_MS - days * DAY).toISOString()

const feature = (id: string, fields: Partial<Feature> = {}): Feature => ({ ...blankFeature(id, id.toUpperCase(), NOW), ...fields })

const roadmapOf = (features: Feature[], fields: Partial<Roadmap> = {}): Roadmap => ({
  schema_version: 2,
  project_id: null,
  name: 'App',
  last_touched: NOW,
  where_i_left_off: 'Done: login. Next: reset.',
  left_off_at: NOW,
  synced_at: null,
  synced_commit: null,
  milestones: [{ id: 'v1', title: 'Launch v1' }],
  features,
  recent_changes: [],
  decisions: [],
  progress_log: [],
  ignored_files: [],
  ...fields,
})

const input = (roadmap: Roadmap | null, fields: Partial<Parameters<typeof summarize>[0]> = {}) => ({
  path: '/work/app',
  name: 'app',
  isHere: false,
  roadmap,
  exists: roadmap !== null,
  evidence: {},
  live: null,
  ...fields,
})

describe('a project card', () => {
  test('progress, who it waits on, what is next, where it was left', () => {
    const roadmap = roadmapOf([
      feature('keys', { status: 'blocked', blocker_reason: 'Stripe key', blocked_on: 'you', milestone: 'v1' }),
      feature('bug', { status: 'blocked', blocker_reason: 'Crash on save', blocked_on: 'code' }),
      feature('login', { status: 'in_progress', note: 'Done: form\nNext: session', milestone: 'v1' }),
      feature('charts', { status: 'done', ui_state: 'polished', functional_state: 'working', verified_by: 'user' }),
    ])
    const card = summarize(input(roadmap, { live: true }), NOW_MS)
    expect(card).toMatchObject({
      state: 'ok',
      name: 'App',
      features: 4,
      done: 1,
      needsYou: [{ title: 'KEYS', reason: 'Stripe key' }],
      needsCode: [{ title: 'BUG', reason: 'Crash on save' }],
      next: { title: 'LOGIN', status: 'in_progress', note: 'Done: form' },
      leftOff: 'Done: login. Next: reset.',
      untouchedDays: 0,
      live: true,
    })
    // The count and the percentage agree: built of planned.
    expect(card.milestones).toEqual([{ title: 'Launch v1', overall: 0, done: 0, total: 2 }])
    expect({ overall: card.overall, built: card.built, planned: card.planned }).toEqual({ overall: 25, built: 1, planned: 4 })
    // A key waits on the person: never thriving.
    expect(card.health?.kind).toBe('needs_you')
  })

  test('a quiet project knows how long it has been', () => {
    const card = summarize(input(roadmapOf([feature('a', { status: 'queued', updated_at: daysAgo(30) })], { last_touched: daysAgo(30) })), NOW_MS)
    expect(card.untouchedDays).toBe(30)
    expect(card.health?.kind).toBe('stalled')
  })

  test("a missing or unreadable features file still gets a card, marked as such", () => {
    expect(summarize(input(null), NOW_MS).state).toBe('missing')
    expect(summarize(input(null, { exists: true }), NOW_MS).state).toBe('unknown')
  })
})

describe('the list', () => {
  test('most recently active first, missing ones last', () => {
    const fresh = summarize(input(roadmapOf([], { name: 'Fresh' }), { path: '/work/fresh' }), NOW_MS)
    const old = summarize(input(roadmapOf([], { name: 'Old', last_touched: daysAgo(9) }), { path: '/work/old' }), NOW_MS)
    const gone = summarize(input(null, { path: '/work/gone', name: 'gone' }), NOW_MS)
    expect(sortProjects([gone, old, fresh]).map(card => card.name)).toEqual(['Fresh', 'Old', 'gone'])
  })
})

describe("a project that can't be read", () => {
  test('is unknown: no zeros for what nobody could count', () => {
    const summary = summarize(input(null, { exists: true }), NOW_MS)
    expect(summary).toMatchObject({ state: 'unknown', features: null, done: null, lastActiveMs: null, untouchedDays: null, overall: null })
  })
  test('sorts with the gone ones, after the projects that can be read', () => {
    const summaries = [summarize(input(null, { exists: true, path: '/a', name: 'A' }), NOW_MS), summarize(input(roadmapOf([feature('a')]), { path: '/b', name: 'B' }), NOW_MS)]
    expect(sortProjects(summaries).map(one => one.name)).toEqual(['App', 'A'])
  })
})
