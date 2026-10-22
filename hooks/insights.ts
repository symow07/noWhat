// Plain readings of a roadmap: what a feature waits on, what finishing it would
// unblock, what happened since the last visit, and how the project is doing.
// Pure, and terse by design: every string here is a headline or a fact.

import type { FeatureEvidence } from './detect'
import { type Feature, type Roadmap, type Status, ago, isStale, nextUp, progress } from './schema'

/** Untouched this many days: the project is stalled, and the sidebar says so. */
export const STALLED_DAYS = 14
/** Touched within this many days: the project is moving. */
export const ACTIVE_DAYS = 7
/** This many sessions on one feature with no change in its state: a rabbit hole. */
export const RABBIT_SESSIONS = 4

const DAY = 86_400_000

export const STATUS_WORDS: Record<Status, string> = {
  done: 'done',
  in_progress: 'in progress',
  blocked: 'blocked',
  parked: 'parked',
  queued: 'queued',
  not_started: 'not started',
}

const byId = (roadmap: Roadmap) => new Map(roadmap.features.map(feature => [feature.id, feature]))

/** What a feature can't move until: its blocker, unfinished dependencies, missing config. */
export function waitingOn(feature: Feature, roadmap: Roadmap, ev: FeatureEvidence | undefined): string[] {
  const features = byId(roadmap)
  const lines: string[] = []
  if (feature.status === 'blocked' && feature.blocker_reason) lines.push(feature.blocker_reason)
  for (const id of feature.depends_on) {
    const dependency = features.get(id)
    if (dependency && dependency.status !== 'done') lines.push(`${dependency.title} (${STATUS_WORDS[dependency.status]})`)
  }
  // A config block detection made already names the keys in its reason.
  if (ev && ev.env_missing.length > 0 && feature.auto_blocked === null) lines.push(`Config: ${ev.env_missing.join(', ')}`)
  return lines
}

/** The unfinished features that wait on this one. */
export function unblocks(feature: Feature, roadmap: Roadmap): Feature[] {
  return roadmap.features.filter(other => other.depends_on.includes(feature.id) && other.status !== 'done')
}

export type CatchUp = {
  /** Was working, now isn't. */
  broke: string[]
  finished: string[]
  /** "Payments (was waiting on RevenueCat keys)". */
  unblocked: string[]
  started: string[]
  blocked: string[]
  parked: string[]
  commits: number
}

/** What happened since `since`, as finished / unblocked / started / blocked / parked. Null when nothing did. */
export function catchUp(roadmap: Roadmap, since: string, commits: number): CatchUp | null {
  const features = byId(roadmap)
  const changes = roadmap.recent_changes.filter(change => change.at > since && change.field === 'status')
  const latest = new Map<string, (typeof changes)[number]>()
  // recent_changes is newest first: the first seen per feature is where it ended up.
  for (const change of changes) if (!latest.has(change.id)) latest.set(change.id, change)
  const ended = (status: Status) => [...latest.values()].filter(change => change.to === status).map(change => change.title)
  const finishedIds = new Set([...latest.values()].filter(change => change.to === 'done').map(change => change.id))

  // Finished says more than unblocked, so a blocker that went straight to done is only finished.
  const unblocked = new Map<string, string>()
  for (const change of latest.values()) {
    const was = changes.find(one => one.id === change.id && one.from === 'blocked')
    if (was && change.to !== 'blocked' && change.to !== 'done') unblocked.set(change.id, change.title)
  }
  for (const feature of roadmap.features) {
    if (feature.status === 'done' || unblocked.has(feature.id)) continue
    const freedBy = feature.depends_on.filter(id => finishedIds.has(id))
    const allDone = feature.depends_on.every(id => features.get(id)?.status === 'done')
    if (freedBy.length > 0 && allDone) {
      unblocked.set(feature.id, `${feature.title} (was waiting on ${freedBy.map(id => features.get(id)?.title ?? id).join(', ')})`)
    }
  }

  const brokeIds = new Set(
    roadmap.recent_changes
      .filter(change => change.at > since && change.field === 'functional_state' && change.from === 'working' && change.to !== 'working')
      .map(change => change.id),
  )
  const result: CatchUp = {
    broke: roadmap.features.filter(feature => brokeIds.has(feature.id) && feature.regressed !== null).map(feature => feature.title),
    finished: ended('done'),
    unblocked: [...unblocked.values()],
    started: ended('in_progress'),
    blocked: ended('blocked'),
    parked: ended('parked'),
    commits,
  }
  const isQuiet = Object.values(result).every(value => (Array.isArray(value) ? value.length === 0 : value === 0))
  return isQuiet ? null : result
}

/** When anything last moved, in ms: the roadmap's own last touch, or the newest commit to any feature. */
export function lastActive(roadmap: Roadmap, evidence: Readonly<Record<string, FeatureEvidence>>): number {
  let last = Date.parse(roadmap.last_touched) || 0
  for (const ev of Object.values(evidence)) {
    if (ev.last_change) last = Math.max(last, Date.parse(ev.last_change) || 0)
  }
  return last
}

/** Days since anything moved. */
export function untouchedDays(roadmap: Roadmap, evidence: Readonly<Record<string, FeatureEvidence>>, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - lastActive(roadmap, evidence)) / DAY))
}

export type Health = { kind: 'thriving' | 'steady' | 'stalled' | 'needs_you'; label: string; detail: string }

/**
 * How the project is doing, for a glance across projects:
 * stalled when nothing moved in STALLED_DAYS, or all work in progress is stale;
 * needs you when it waits on the person and nothing else is moving;
 * thriving when it moved this week; steady otherwise.
 */
export function healthOf(roadmap: Roadmap, evidence: Readonly<Record<string, FeatureEvidence>>, nowMs: number): Health {
  const days = untouchedDays(roadmap, evidence, nowMs)
  const needsYou = roadmap.features.filter(feature => feature.status === 'blocked' && feature.blocked_on === 'you').length
  const inProgress = roadmap.features.filter(feature => feature.status === 'in_progress')
  const moving = inProgress.filter(feature => !isStale(feature, evidence[feature.id]?.last_change ?? null, nowMs))

  if (days >= STALLED_DAYS) return { kind: 'stalled', label: 'Stalled', detail: `Untouched ${days} days` }
  if (needsYou > 0 && moving.length === 0) return { kind: 'needs_you', label: 'Needs you', detail: `${needsYou} waiting on you` }
  if (inProgress.length > 0 && moving.length === 0) return { kind: 'stalled', label: 'Stalled', detail: 'Work in progress has gone stale' }
  if (days < ACTIVE_DAYS) return { kind: 'thriving', label: 'Thriving', detail: days === 0 ? 'Active today' : `Active ${days}d ago` }
  return { kind: 'steady', label: 'Steady', detail: `Last active ${days} days ago` }
}

/** Features with many sessions since their state last changed, most first. */
export function rabbitHoles(roadmap: Roadmap): { feature: Feature; sessions: number }[] {
  return roadmap.features
    .filter(feature => feature.status !== 'done' && feature.status !== 'parked' && !feature.idea)
    .map(feature => ({ feature, sessions: feature.sessions.filter(session => session.at > (feature.progress_at ?? '')).length }))
    .filter(hole => hole.sessions >= RABBIT_SESSIONS)
    .sort((a, b) => b.sessions - a.sessions)
}

export type Alert = { kind: 'broke' | 'down' | 'rabbit' | 'stale' | 'quiet'; label: string; text: string }

/**
 * What's wrong, worst first: features that broke, the deployed app down, rabbit
 * holes, stale work, a project left alone. Empty when nothing is: the strip hides.
 */
export function alertsOf(
  roadmap: Roadmap,
  evidence: Readonly<Record<string, FeatureEvidence>>,
  live: { ok: boolean; status: number } | null,
  nowMs: number,
): Alert[] {
  const alerts: Alert[] = []
  for (const feature of roadmap.features) {
    if (feature.regressed === null || feature.status === 'parked') continue
    const reason = feature.regressed.reason === 'tests fail' ? `Tests fail since ${ago(feature.regressed.at, nowMs)}.` : `${capital(feature.regressed.reason)}.`
    alerts.push({ kind: 'broke', label: 'Broke', text: `${feature.title}. ${reason}` })
  }
  if (live && !live.ok) alerts.push({ kind: 'down', label: 'Down', text: live.status ? `Deployed app answers ${live.status}.` : 'Deployed app not answering.' })
  for (const hole of rabbitHoles(roadmap)) {
    alerts.push({ kind: 'rabbit', label: 'Rabbit hole', text: `${hole.feature.title}. ${hole.sessions} sessions, no progress.` })
  }
  for (const feature of roadmap.features) {
    if (isStale(feature, evidence[feature.id]?.last_change ?? null, nowMs)) {
      alerts.push({ kind: 'stale', label: 'Stale', text: `${feature.title}. In progress, untouched ${ago(feature.updated_at, nowMs).replace(' ago', '')}.` })
    }
  }
  const days = untouchedDays(roadmap, evidence, nowMs)
  if (days >= STALLED_DAYS) alerts.push({ kind: 'quiet', label: 'Untouched', text: `${days} days. Pick it up or park it.` })
  return alerts
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** Features added and finished in the last 7 days: is scope growing faster than work gets done? */
export function scopeWeek(roadmap: Roadmap, nowMs: number): { added: string[]; done: string[] } {
  const since = new Date(nowMs - 7 * DAY).toISOString()
  const recent = roadmap.recent_changes.filter(change => change.at >= since)
  const titles = (pick: (change: (typeof recent)[number]) => boolean) => [...new Map(recent.filter(pick).map(change => [change.id, change.title])).values()]
  return {
    added: titles(change => change.field === 'added'),
    done: titles(change => change.field === 'status' && change.to === 'done'),
  }
}

const SHORT_DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** "13 Oct". */
export const shortDate = (iso: string) => SHORT_DATE.format(new Date(iso))

/** A short progress report for the week, to paste anywhere: at most five lines. */
export function weeklySummary(roadmap: Roadmap, evidence: Readonly<Record<string, FeatureEvidence>>, nowMs: number): string {
  const now = new Date(nowMs)
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)))
  const overall = progress(roadmap).overall
  const weekAgo = new Date(nowMs - 7 * DAY).toISOString().slice(0, 10)
  const before = [...roadmap.progress_log].reverse().find(entry => entry.day <= weekAgo)?.overall
  const delta = overall !== null && typeof before === 'number' && overall !== before ? ` (${overall > before ? '+' : ''}${overall - before})` : ''
  const week = scopeWeek(roadmap, nowMs)
  const waiting = roadmap.features.filter(feature => feature.status === 'blocked' && feature.blocked_on === 'you')
  const broke = roadmap.features.filter(feature => feature.regressed !== null)
  const next = nextUp(roadmap)
  const list = (items: readonly string[], limit: number) => items.slice(0, limit).join(', ') + (items.length > limit ? ` +${items.length - limit}` : '')

  return [
    `${roadmap.name} · week of ${shortDate(monday.toISOString())}`,
    `${overall ?? 0}%${delta}. Done: ${week.done.length > 0 ? list(week.done, 3) : 'nothing'}.`,
    waiting.length > 0 ? `Waiting on you: ${waiting.length} (${list(waiting.map(feature => feature.title), 3)}).` : '',
    broke.length > 0 ? `Broke: ${list(broke.map(feature => feature.title), 3)}.` : '',
    next ? `Next: ${next.title}.` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
