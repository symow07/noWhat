import { describe, expect, test } from 'claude-code/testing'

import {
  type Feature,
  type Roadmap,
  applyUpdate,
  captureIdea,
  contextLine,
  keepChanges,
  recordProgress,
  touchSession,
  inferBlockedOn,
  isStale,
  nextUp,
  diffOutside,
  serialize,
  progress,
  reorderQueue,
  snapshotOf,
  validate,
} from '../hooks/schema'

const NOW = '2026-10-12T20:00:00.000Z'
const LATER = '2026-10-12T21:00:00.000Z'

function feature(id: string, fields: Partial<Feature> = {}): Feature {
  return {
    id,
    title: id,
    description: '',
    kind: 'ui',
    status: 'not_started',
    ui_state: 'none',
    functional_state: 'none',
    verified_by: null,
    blocker_reason: null,
    blocked_on: null,
    auto_blocked: null,
    milestone: null,
    note: '',
    parked_reason: null,
    depends_on: [],
    pinned: false,
    related_files: [],
    needs_config: [],
    last_conversation: null,
    thumbnail: null,
    updated_at: NOW,
    idea: false,
    sessions: [],
    progress_at: null,
    regressed: null,
    ...fields,
  }
}

function roadmap(features: Feature[]): Roadmap {
  return {
    schema_version: 2,
    project_id: null,
    name: 'Sample',
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
  }
}

const context = { now: LATER, conversation: { session_id: 's1', title: 'Wire up login', at: LATER } }

describe('validate', () => {
  test('fills the optional fields', () => {
    const checked = validate({ name: 'Sample', features: [{ id: 'login', title: 'Login', status: 'queued' }] }, NOW)
    expect(checked.errors).toEqual([])
    expect(checked.roadmap?.features[0]).toMatchObject({
      kind: 'ui',
      ui_state: 'none',
      functional_state: 'none',
      blocker_reason: null,
      related_files: [],
      updated_at: NOW,
    })
  })

  test('refuses bad states, a blocker with no reason, twin ids and UI on logic', () => {
    const checked = validate(
      {
        name: 'Sample',
        features: [
          { id: 'a', title: 'A', status: 'wip' },
          { id: 'b', title: 'B', status: 'blocked' },
          { id: 'c', title: 'C', status: 'done' },
          { id: 'c', title: 'C again', status: 'done' },
          { id: 'd', title: 'D', status: 'done', kind: 'logic', ui_state: 'designed' },
          { id: 'Bad Id', title: 'E', status: 'done' },
        ],
      },
      NOW,
    )
    expect(checked.roadmap).toBeNull()
    expect(checked.errors).toHaveLength(5)
    expect(checked.errors.join('\n')).toContain('status is "wip"')
    expect(checked.errors.join('\n')).toContain('needs a blocker_reason')
    expect(checked.errors.join('\n')).toContain('"c" is used twice')
    expect(checked.errors.join('\n')).toContain('kind "logic" has no UI: leave ui_state out')
    expect(checked.errors.join('\n')).toContain('kebab-case')
  })

  test('drops a stale blocker_reason from a feature that is not blocked', () => {
    const checked = validate(
      { name: 'Sample', features: [{ id: 'a', title: 'A', status: 'done', blocker_reason: 'old' }] },
      NOW,
    )
    expect(checked.roadmap?.features[0]?.blocker_reason).toBeNull()
  })
})

describe('progress', () => {
  test('averages UI and functional, counting queued and not started as 0', () => {
    const p = progress(
      roadmap([
        feature('a', { status: 'done', ui_state: 'polished', functional_state: 'working' }),
        feature('b', { status: 'in_progress', ui_state: 'polished', functional_state: 'partial' }),
        feature('c', { status: 'queued', ui_state: 'designed', functional_state: 'partial' }),
        feature('d', { status: 'in_progress', kind: 'logic', functional_state: 'working' }),
      ]),
    )
    // UI over a, b, c: (1 + 1 + 0) / 3. Functional over all four: (1 + 0.5 + 0 + 1) / 4.
    expect(p.ui).toBe(67)
    expect(p.functional).toBe(63)
    expect(p.overall).toBe(65)
    expect(p.counts).toEqual({ queued: 1, not_started: 0, in_progress: 2, blocked: 0, parked: 0, done: 1 })
    expect(p.designedNotWorking).toEqual(['b'])
  })

  test('uses functional alone when nothing has a UI, and null with no features', () => {
    expect(progress(roadmap([feature('a', { kind: 'logic', status: 'done', functional_state: 'working' })])).overall).toBe(100)
    expect(progress(roadmap([])).overall).toBeNull()
  })

  test('flags working but not polished, and keeps a blocked feature at its states', () => {
    const p = progress(
      roadmap([feature('a', { status: 'blocked', blocker_reason: 'API key', ui_state: 'designed', functional_state: 'working' })]),
    )
    expect(p.workingNotPolished).toEqual(['a'])
    expect(p.ui).toBe(50)
    expect(p.functional).toBe(100)
  })
})

describe('applyUpdate', () => {
  test('done changes no state, and an unconfirmed done shows as unverified', () => {
    const before = roadmap([feature('a', { status: 'in_progress', ui_state: 'designed', functional_state: 'partial' })])
    const applied = applyUpdate(before, { changes: [{ id: 'a', status: 'done' }] }, context)
    expect(applied.roadmap?.features[0]).toMatchObject({ ui_state: 'designed', functional_state: 'partial' })
    expect(applied.roadmap?.features[0]?.last_conversation?.title).toBe('Wire up login')
    expect(applied.stopped).toEqual(['a'])
    expect(progress(applied.roadmap as Roadmap).unverified).toEqual(['a'])
  })

  test('working needs verified_by, which goes again when it stops working', () => {
    const before = roadmap([feature('a', { status: 'done', functional_state: 'partial' })])
    const refused = applyUpdate(before, { changes: [{ id: 'a', functional_state: 'working' }] }, context)
    expect(refused.errors[0]).toContain('working needs verified_by')
    const confirmed = applyUpdate(before, { changes: [{ id: 'a', functional_state: 'working', verified_by: 'tests' }] }, context)
    expect(confirmed.roadmap?.features[0]?.verified_by).toBe('tests')
    expect(progress(confirmed.roadmap as Roadmap).unverified).toEqual([])
    const broken = applyUpdate(confirmed.roadmap as Roadmap, { changes: [{ id: 'a', functional_state: 'partial' }] }, context)
    expect(broken.roadmap?.features[0]?.verified_by).toBeNull()
  })

  test('a logic feature has no ui_state, in memory or in the file', () => {
    const before = roadmap([feature('a')])
    const refused = applyUpdate(before, { changes: [{ id: 'a', kind: 'logic', ui_state: 'designed' }] }, context)
    expect(refused.errors[0]).toContain('leave ui_state out')
    const logic = applyUpdate(before, { changes: [{ id: 'a', kind: 'logic' }] }, context).roadmap as Roadmap
    expect(logic.features[0]?.ui_state).toBeNull()
    expect(JSON.parse(serialize(logic)).features[0]).not.toHaveProperty('ui_state')
    const back = applyUpdate(logic, { changes: [{ id: 'a', kind: 'ui' }] }, context).roadmap as Roadmap
    expect(back.features[0]?.ui_state).toBe('none')
  })

  test('strict validation of Claude input wants working confirmed', () => {
    const raw = { name: 'Sample', features: [{ id: 'a', title: 'A', status: 'done', functional_state: 'working' }] }
    expect(validate(raw, NOW).roadmap).not.toBeNull()
    expect(validate(raw, NOW, { strict: true }).errors[0]).toContain('working needs verified_by')
  })

  test('blocked needs a reason, and leaving blocked clears it', () => {
    const before = roadmap([feature('a', { status: 'in_progress' })])
    expect(applyUpdate(before, { changes: [{ id: 'a', status: 'blocked' }] }, context).errors[0]).toContain('blocker_reason')
    const blocked = applyUpdate(before, { changes: [{ id: 'a', status: 'blocked', blocker_reason: 'Waiting on the Stripe key' }] }, context)
    expect(blocked.roadmap?.features[0]?.blocker_reason).toBe('Waiting on the Stripe key')
    const unblocked = applyUpdate(blocked.roadmap as Roadmap, { changes: [{ id: 'a', status: 'in_progress' }] }, context)
    expect(unblocked.roadmap?.features[0]?.blocker_reason).toBeNull()
    expect(unblocked.started).toEqual(['a'])
  })

  test('adds a feature only when given a title, and saves nothing on any error', () => {
    const before = roadmap([feature('a')])
    const refused = applyUpdate(before, { changes: [{ id: 'a', status: 'done' }, { id: 'ghost' }] }, context)
    expect(refused.roadmap).toBeNull()
    expect(refused.errors[0]).toContain('no feature "ghost"')
    const added = applyUpdate(before, { changes: [{ id: 'reset-email', title: 'Password reset email', status: 'in_progress' }] }, context)
    expect(added.roadmap?.features.map(one => one.id)).toEqual(['a', 'reset-email'])
    expect(added.started).toEqual(['reset-email'])
    expect(added.roadmap?.recent_changes[0]).toMatchObject({ id: 'reset-email', field: 'added', to: 'in_progress' })
  })

  test('logs state changes newest first', () => {
    let current = roadmap([feature('a'), feature('b')])
    const steps: Feature['status'][] = ['queued', 'in_progress', 'done']
    for (const status of steps) {
      current = applyUpdate(current, { changes: [{ id: 'a', status }, { id: 'b', status }] }, context).roadmap as Roadmap
    }
    expect(current.recent_changes).toHaveLength(6)
    expect(current.recent_changes[0]).toMatchObject({ id: 'b', field: 'status', from: 'in_progress', to: 'done' })
    expect(current.recent_changes[1]).toMatchObject({ id: 'a', field: 'status', from: 'in_progress', to: 'done' })
  })

  test('where_i_left_off stamps when it was written', () => {
    const applied = applyUpdate(roadmap([]), { where_i_left_off: 'Login wired; next is reset email.' }, context)
    expect(applied.roadmap).toMatchObject({ where_i_left_off: 'Login wired; next is reset email.', left_off_at: LATER })
  })

  test('add_files keeps paths unique', () => {
    const before = roadmap([feature('a', { related_files: ['src/a.ts'] })])
    const applied = applyUpdate(before, { changes: [{ id: 'a', add_files: ['src/b.ts', 'src/a.ts'] }] }, context)
    expect(applied.roadmap?.features[0]?.related_files).toEqual(['src/b.ts', 'src/a.ts'])
  })
})

describe('queue and outside changes', () => {
  test('reorders queued features in place, leaving the rest where they are', () => {
    const features = [
      feature('q1', { status: 'queued' }),
      feature('x', { status: 'done' }),
      feature('q2', { status: 'queued' }),
      feature('q3', { status: 'queued' }),
    ]
    expect(reorderQueue(features, ['q3', 'q1']).map(one => one.id)).toEqual(['q3', 'x', 'q1', 'q2'])
  })

  test('finds what changed outside the mod', () => {
    const before = snapshotOf(roadmap([feature('a'), feature('gone')]))
    const after = roadmap([feature('a', { status: 'done' }), feature('new')])
    const changes = diffOutside(before, after, LATER)
    expect(changes.map(change => `${change.id}:${change.field}:${change.source}`)).toEqual([
      'a:status:outside',
      'new:added:outside',
      'gone:removed:outside',
    ])
  })

  test('the context line names the active feature and blockers', () => {
    const line = contextLine(
      roadmap([feature('a', { status: 'in_progress' }), feature('b', { status: 'blocked', blocker_reason: 'API key' })]),
      'a',
    )
    expect(line).toContain('Active feature (your file edits are filed under it): a.')
    expect(line).toContain('Blocked: b (API key).')
  })
})

describe('version 2: milestones, blockers, next up', () => {
  test('a version 1 file is read and upgraded', () => {
    const checked = validate(
      { schema_version: 1, name: 'Old', features: [{ id: 'a', title: 'A', status: 'blocked', blocker_reason: 'API key' }] },
      NOW,
    )
    expect(checked.roadmap).toMatchObject({ schema_version: 2, milestones: [], synced_commit: null })
    // Waiting on a key is the person's to clear.
    expect(checked.roadmap?.features[0]).toMatchObject({ blocked_on: 'you', auto_blocked: null, milestone: null })
  })

  test('who a blocker waits on is read from its reason', () => {
    expect(inferBlockedOn('RevenueCat keys not set')).toBe('you')
    expect(inferBlockedOn('Needs an App Store Connect account')).toBe('you')
    expect(inferBlockedOn('STRIPE_SECRET missing in production')).toBe('you')
    expect(inferBlockedOn('Webhook handler not written')).toBe('code')
  })

  test('a feature names an existing milestone', () => {
    const raw = { name: 'B', milestones: [{ id: 'v1', title: 'Launch v1' }], features: [{ id: 'a', title: 'A', status: 'done', milestone: 'v2' }] }
    expect(validate(raw, NOW).errors[0]).toContain('milestone "v2" isn\'t in milestones')
  })

  test('blocked says on whom, and leaving blocked clears it all', () => {
    const before = roadmap([feature('a', { status: 'in_progress' })])
    const blocked = applyUpdate(before, { changes: [{ id: 'a', status: 'blocked', blocker_reason: 'Stripe key', blocked_on: 'you' }] }, context)
    expect(blocked.roadmap?.features[0]).toMatchObject({ blocked_on: 'you', blocker_reason: 'Stripe key' })
    const back = applyUpdate(blocked.roadmap as Roadmap, { changes: [{ id: 'a', status: 'in_progress' }] }, context)
    expect(back.roadmap?.features[0]).toMatchObject({ blocked_on: null, blocker_reason: null, auto_blocked: null })
  })

  test('replacing the milestones drops membership of one that went', () => {
    const before = { ...roadmap([feature('a', { milestone: 'v1' })]), milestones: [{ id: 'v1', title: 'Launch v1' }] }
    const applied = applyUpdate(before, { milestones: [{ id: 'later', title: 'Post-launch' }] }, context)
    expect(applied.roadmap?.features[0]?.milestone).toBeNull()
    expect(applied.roadmap?.milestones).toEqual([{ id: 'later', title: 'Post-launch' }])
  })

  test('a sync records the commit it reached', () => {
    const applied = applyUpdate(roadmap([]), { synced: true }, { ...context, head: 'abc123' })
    expect(applied.roadmap).toMatchObject({ synced_at: LATER, synced_commit: 'abc123' })
  })

  test('next up: in progress first, then the queue, then a code blocker, then the earliest milestone', () => {
    const base = roadmap([
      feature('later', { status: 'not_started', milestone: 'post' }),
      feature('soon', { status: 'not_started', milestone: 'v1' }),
      feature('stuck', { status: 'blocked', blocker_reason: 'bug', blocked_on: 'code' }),
      feature('q', { status: 'queued' }),
      feature('doing', { status: 'in_progress' }),
    ])
    const withMilestones = { ...base, milestones: [{ id: 'v1', title: 'V1' }, { id: 'post', title: 'Post' }] }
    expect(nextUp(withMilestones)?.id).toBe('doing')
    const noProgress = { ...withMilestones, features: withMilestones.features.filter(one => one.id !== 'doing') }
    expect(nextUp(noProgress)?.id).toBe('q')
    expect(nextUp({ ...noProgress, features: noProgress.features.filter(one => one.id !== 'q') })?.id).toBe('stuck')
    expect(nextUp({ ...noProgress, features: noProgress.features.filter(one => one.id === 'later' || one.id === 'soon') })?.id).toBe('soon')
  })

  test('notes stay terse: four short lines at most', () => {
    const base = roadmap([feature('a')])
    const ok = applyUpdate(base, { changes: [{ id: 'a', note: 'Done: parser\nNext: webhook' }] }, context)
    expect(ok.roadmap?.features[0]?.note).toBe('Done: parser\nNext: webhook')
    const long = applyUpdate(base, { changes: [{ id: 'a', note: 'one\ntwo\nthree\nfour\nfive' }] }, context)
    expect(long.roadmap).toBeNull()
    expect(long.errors[0]).toContain('at most 4 short lines')
    const essay = applyUpdate(base, { changes: [{ id: 'a', status: 'blocked', blocker_reason: 'x'.repeat(200) }] }, context)
    expect(essay.errors[0]).toContain('keep it to 140')
  })

  test('parked needs a reason, which goes when it is picked up again', () => {
    const base = roadmap([feature('a', { status: 'queued' })])
    expect(applyUpdate(base, { changes: [{ id: 'a', status: 'parked' }] }, context).errors[0]).toContain('parked_reason')
    const parked = applyUpdate(base, { changes: [{ id: 'a', status: 'parked', parked_reason: 'Waiting on pricing decision' }] }, context)
    expect(parked.roadmap?.features[0]).toMatchObject({ status: 'parked', parked_reason: 'Waiting on pricing decision' })
    const back = applyUpdate(parked.roadmap as Roadmap, { changes: [{ id: 'a', status: 'queued' }] }, context)
    expect(back.roadmap?.features[0]?.parked_reason).toBeNull()
  })

  test('depends_on names existing features, and next up skips what still waits', () => {
    const base = roadmap([feature('keys', { status: 'blocked', blocker_reason: 'RevenueCat keys', blocked_on: 'you' }), feature('pay', { status: 'queued' }), feature('free', { status: 'queued' })])
    expect(applyUpdate(base, { changes: [{ id: 'pay', depends_on: ['nope'] }] }, context).roadmap).toBeNull()
    const linked = applyUpdate(base, { changes: [{ id: 'pay', depends_on: ['keys'] }] }, context).roadmap as Roadmap
    expect(linked.features[1]?.depends_on).toEqual(['keys'])
    expect(nextUp(linked)?.id).toBe('free')
  })

  test('stale: in progress and untouched for a week', () => {
    const old = feature('a', { status: 'in_progress', updated_at: '2026-10-01T00:00:00.000Z' })
    const nowMs = Date.parse('2026-10-12T00:00:00.000Z')
    expect(isStale(old, null, nowMs)).toBe(true)
    expect(isStale(old, '2026-10-10T00:00:00.000Z', nowMs)).toBe(false)
    expect(isStale({ ...old, status: 'done' }, null, nowMs)).toBe(false)
  })
})

describe('history, ideas, sessions, decisions', () => {
  test('the change log keeps five weeks, at least 20 entries', () => {
    const at = (days: number) => new Date(Date.parse(NOW) - days * 86_400_000).toISOString()
    const change = (days: number) => ({ at: at(days), id: 'a', title: 'A', field: 'status' as const, from: 'queued', to: 'done', source: 'claude' as const })
    const log = [...Array.from({ length: 30 }, (_, n) => change(n)), ...Array.from({ length: 10 }, () => change(60))]
    expect(keepChanges(log, NOW)).toHaveLength(30)
    expect(keepChanges(Array.from({ length: 25 }, () => change(90)), NOW)).toHaveLength(20)
  })

  test('a captured idea goes to the backlog, out of progress and never next up', () => {
    const base = roadmap([feature('split-bills', { status: 'done', functional_state: 'working', verified_by: 'user' })])
    const captured = captureIdea(base, '  Split  bills ', NOW)
    if ('error' in captured) throw new Error(captured.error)
    expect(captured.id).toBe('split-bills-2')
    const idea = captured.roadmap.features[1]
    expect(idea).toMatchObject({ title: 'Split bills', idea: true, status: 'not_started', kind: 'logic' })
    expect(captured.roadmap.recent_changes[0]).toMatchObject({ field: 'added', source: 'you' })
    expect(progress(captured.roadmap).overall).toBe(progress(base).overall)
    expect(nextUp(captured.roadmap)).toBeNull()
    expect(captureIdea(base, ' ', NOW)).toEqual({ error: 'Type an idea first.' })
    expect('error' in captureIdea(base, 'x'.repeat(81), NOW)).toBe(true)
    // Planning it makes it ordinary work.
    const planned = applyUpdate(captured.roadmap, { changes: [{ id: 'split-bills-2', status: 'queued' }] }, context)
    expect(planned.roadmap?.features[1]?.idea).toBe(false)
  })

  test('an update stamps progress and the session, once per session', () => {
    const base = roadmap([feature('a', { status: 'queued' })])
    const started = applyUpdate(base, { changes: [{ id: 'a', status: 'in_progress' }] }, context).roadmap as Roadmap
    expect(started.features[0]).toMatchObject({ progress_at: LATER, sessions: [{ id: 's1', at: LATER }] })
    const noted = applyUpdate(started, { changes: [{ id: 'a', note: 'Done: x' }] }, { ...context, now: '2026-10-12T22:00:00.000Z' }).roadmap as Roadmap
    // A note isn't progress, and the same session isn't counted twice.
    expect(noted.features[0]).toMatchObject({ progress_at: LATER, sessions: [{ id: 's1', at: LATER }] })
    expect(touchSession(noted.features[0] as Feature, { session_id: 's2', title: null, at: '2026-10-13T00:00:00.000Z' }).sessions).toHaveLength(2)
  })

  test('working again clears a regression', () => {
    const base = roadmap([feature('a', { status: 'done', functional_state: 'partial', regressed: { at: NOW, reason: 'tests fail' } })])
    expect(nextUp(base)?.id).toBe('a')
    const fixed = applyUpdate(base, { changes: [{ id: 'a', functional_state: 'working', verified_by: 'ran' }] }, context).roadmap as Roadmap
    expect(fixed.features[0]?.regressed).toBeNull()
    expect(contextLine(base, null)).toContain('Broke (was working): a (tests fail).')
  })

  test('decisions: one line each, newest first, about a feature that exists', () => {
    const base = roadmap([feature('a')])
    const saved = applyUpdate(base, { decisions: [{ text: 'Polling, because push needs a verified app', feature: 'a' }, { text: 'Bun, because the tests already run on it' }] }, context)
    expect(saved.roadmap?.decisions).toEqual([
      { at: LATER, text: 'Bun, because the tests already run on it', feature: null },
      { at: LATER, text: 'Polling, because push needs a verified app', feature: 'a' },
    ])
    expect(applyUpdate(base, { decisions: [{ text: 'x'.repeat(161) }] }, context).errors[0]).toContain('keep it to 160')
    expect(applyUpdate(base, { decisions: [{ text: 'Fine', feature: 'nope' }] }, context).errors[0]).toContain('no feature "nope"')
  })

  test('the file keeps the project id, the decisions and one progress entry per day', () => {
    const base = { ...roadmap([feature('a')]), project_id: 'p-1' }
    const day1 = recordProgress(base, NOW)
    const again = recordProgress(day1, LATER)
    expect(again.progress_log).toEqual([{ day: '2026-10-12', overall: 0 }])
    const read = validate(JSON.parse(serialize(again)), NOW).roadmap as Roadmap
    expect(read).toMatchObject({ project_id: 'p-1', progress_log: [{ day: '2026-10-12', overall: 0 }], decisions: [] })
  })
})

describe('a sort', () => {
  test('files it leaves out stay out, and the file keeps them', () => {
    const base = roadmap([feature('a')])
    const sorted = applyUpdate(base, { ignore_files: ['scripts/', 'src/gen.ts', 'scripts/'], synced: true }, { ...context, head: 'abc' }).roadmap as Roadmap
    expect(sorted.ignored_files).toEqual(['scripts/', 'src/gen.ts'])
    expect(sorted.synced_commit).toBe('abc')
    expect((validate(JSON.parse(serialize(sorted)), NOW).roadmap as Roadmap).ignored_files).toEqual(['scripts/', 'src/gen.ts'])
    expect(applyUpdate(base, { ignore_files: 'scripts/' as never }, context).errors[0]).toContain('ignore_files')
  })
})
