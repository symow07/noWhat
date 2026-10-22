import { describe, expect, test } from 'claude-code/testing'

import type { FeatureEvidence } from '../hooks/detect'
import { alertsOf, catchUp, healthOf, rabbitHoles, scopeWeek, unblocks, untouchedDays, waitingOn, weeklySummary } from '../hooks/insights'
import { type Change, type Feature, type Roadmap, blankFeature } from '../hooks/schema'

const NOW = '2026-10-12T12:00:00.000Z'
const NOW_MS = Date.parse(NOW)
const DAY = 86_400_000

const feature = (id: string, fields: Partial<Feature> = {}): Feature => ({ ...blankFeature(id, id.toUpperCase(), NOW), ...fields })

function roadmapOf(features: Feature[], fields: Partial<Roadmap> = {}): Roadmap {
  return {
    schema_version: 2,
    project_id: null,
    name: 'App',
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
    ...fields,
  }
}

const change = (at: string, id: string, from: string, to: string): Change => ({
  at,
  id,
  title: id.toUpperCase(),
  field: 'status',
  from,
  to,
  source: 'claude',
})

const ev = (fields: Partial<FeatureEvidence> = {}): FeatureEvidence => ({
  files: [],
  env_required: [],
  env_missing: [],
  env_source: null,
  tests: [],
  tests_status: 'none',
  last_change: null,
  recent_changes: 0,
  uncommitted: false,
  commits: [],
  ...fields,
})

describe('dependencies', () => {
  const keys = feature('keys', { status: 'blocked', blocker_reason: 'RevenueCat keys', blocked_on: 'you' })
  const pay = feature('pay', { status: 'queued', depends_on: ['keys'] })
  const roadmap = roadmapOf([keys, pay])

  test('what a feature waits on, and what finishing one unblocks', () => {
    expect(waitingOn(pay, roadmap, undefined)).toEqual(['KEYS (blocked)'])
    expect(waitingOn(keys, roadmap, ev({ env_missing: ['RC_KEY'] }))).toEqual(['RevenueCat keys', 'Config: RC_KEY'])
    expect(unblocks(keys, roadmap).map(one => one.id)).toEqual(['pay'])
    expect(unblocks(keys, { ...roadmap, features: [keys, { ...pay, status: 'done' }] })).toEqual([])
  })
})

describe('since your last visit', () => {
  const since = '2026-10-10T00:00:00.000Z'

  test('finished, and what that unblocked, in plain words', () => {
    const roadmap = roadmapOf([feature('keys', { status: 'done' }), feature('pay', { status: 'queued', depends_on: ['keys'] }), feature('ui', { status: 'in_progress' })], {
      recent_changes: [
        change('2026-10-11T10:00:00.000Z', 'ui', 'queued', 'in_progress'),
        change('2026-10-11T09:00:00.000Z', 'keys', 'blocked', 'done'),
        change('2026-10-01T00:00:00.000Z', 'pay', 'not_started', 'queued'),
      ],
    })
    expect(catchUp(roadmap, since, 3)).toEqual({
      broke: [],
      finished: ['KEYS'],
      unblocked: ['PAY (was waiting on KEYS)'],
      started: ['UI'],
      blocked: [],
      parked: [],
      commits: 3,
    })
  })

  test('nothing happened: nothing to say', () => {
    expect(catchUp(roadmapOf([feature('a')]), since, 0)).toBeNull()
  })
})

describe('health', () => {
  test('thriving, needs you, stalled', () => {
    const moving = roadmapOf([feature('a', { status: 'in_progress', updated_at: NOW })])
    expect(healthOf(moving, {}, NOW_MS).kind).toBe('thriving')

    const waiting = roadmapOf([feature('a', { status: 'blocked', blocker_reason: 'Stripe key', blocked_on: 'you' })])
    expect(healthOf(waiting, {}, NOW_MS)).toMatchObject({ kind: 'needs_you', detail: '1 waiting on you' })

    const old = new Date(NOW_MS - 20 * DAY).toISOString()
    const quiet = roadmapOf([feature('a', { status: 'queued', updated_at: old })], { last_touched: old })
    expect(healthOf(quiet, {}, NOW_MS)).toMatchObject({ kind: 'stalled', detail: 'Untouched 20 days' })
    // A commit to a feature's files counts as activity, wherever it came from.
    expect(untouchedDays(quiet, { a: ev({ last_change: new Date(NOW_MS - 2 * DAY).toISOString() }) }, NOW_MS)).toBe(2)
  })
})

describe('alerts, rabbit holes, scope and the weekly summary', () => {
  const at = (days: number) => new Date(NOW_MS - days * DAY).toISOString()

  test('nothing wrong, no alerts; then worst first', () => {
    expect(alertsOf(roadmapOf([feature('a', { status: 'queued' })]), {}, null, NOW_MS)).toEqual([])
    const sessions = Array.from({ length: 5 }, (_, n) => ({ id: `s${n}`, at: at(4 - n) }))
    const roadmap = roadmapOf([
      feature('charts', { status: 'in_progress', progress_at: at(10), sessions }),
      feature('export', { status: 'done', regressed: { at: at(0), reason: 'tests fail' } }),
    ])
    const alerts = alertsOf(roadmap, {}, { ok: false, status: 502 }, NOW_MS)
    expect(alerts.map(alert => alert.kind)).toEqual(['broke', 'down', 'rabbit'])
    expect(alerts[0]?.text).toBe('EXPORT. Tests fail since just now.')
    expect(alerts[1]?.text).toBe('Deployed app answers 502.')
    expect(alerts[2]?.text).toBe('CHARTS. 5 sessions, no progress.')
    // Progress since resets the count.
    expect(rabbitHoles(roadmapOf([feature('charts', { status: 'in_progress', progress_at: at(1), sessions })]))).toEqual([])
  })

  test('scope this week: added against finished', () => {
    const change = (days: number, id: string, field: 'added' | 'status', to: string) => ({ at: at(days), id, title: id.toUpperCase(), field, from: null, to, source: 'claude' as const })
    const roadmap = roadmapOf([], {
      recent_changes: [change(1, 'a', 'added', 'not_started'), change(2, 'b', 'added', 'queued'), change(3, 'c', 'status', 'done'), change(9, 'd', 'added', 'queued')],
    })
    expect(scopeWeek(roadmap, NOW_MS)).toEqual({ added: ['A', 'B'], done: ['C'] })
  })

  test('the weekly summary: five short lines at most', () => {
    const roadmap = roadmapOf(
      [
        feature('keys', { status: 'blocked', blocker_reason: 'Stripe key', blocked_on: 'you' }),
        feature('pay', { status: 'in_progress' }),
        feature('done-one', { status: 'done', functional_state: 'working', verified_by: 'user' }),
      ],
      {
        name: 'Shop',
        recent_changes: [{ at: at(1), id: 'done-one', title: 'Checkout', field: 'status', from: 'in_progress', to: 'done', source: 'claude' }],
        progress_log: [{ day: at(8).slice(0, 10), overall: 10 }],
      },
    )
    const summary = weeklySummary(roadmap, {}, NOW_MS).split('\n')
    expect(summary).toEqual(['Shop · week of 12 Oct', '17% (+7). Done: Checkout.', 'Waiting on you: 1 (KEYS).', 'Next: PAY.'])
  })
})
