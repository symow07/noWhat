// Plain readings of a roadmap: what a feature waits on, what finishing it would
// unblock, what happened since the last visit, and how the project is doing.
// Pure, and terse by design: every string here is a headline or a fact.

import type { FeatureEvidence } from './detect'
import { type Feature, type Roadmap, type Status, ago, isBuilt, isStale, lastTouchedMs, nextUp, progress } from './schema'

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

/** When anything last moved, in ms: the roadmap's own last touch, or the newest commit to any feature. Null when no date can be read. */
export function lastActive(roadmap: Roadmap, evidence: Readonly<Record<string, FeatureEvidence>>): number | null {
  const dates = [roadmap.last_touched, ...Object.values(evidence).map(ev => ev.last_change ?? '')].map(date => Date.parse(date)).filter(Number.isFinite)
  return dates.length > 0 ? Math.max(...dates) : null
}

/** Days since anything moved; null when that can't be read. */
export function untouchedDays(roadmap: Roadmap, evidence: Readonly<Record<string, FeatureEvidence>>, nowMs: number): number | null {
  const last = lastActive(roadmap, evidence)
  return last === null ? null : Math.max(0, Math.floor((nowMs - last) / DAY))
}

export type Health = { kind: 'thriving' | 'steady' | 'stalled' | 'needs_you' | 'unknown'; label: string; detail: string }

/**
 * How the project is doing, for a glance across projects:
 * stalled when nothing moved in STALLED_DAYS; needs you whenever anything
 * waits on the person (never "thriving" past an open item of theirs);
 * stalled when all work in progress is stale; thriving when it moved this
 * week; steady otherwise.
 */
export function healthOf(roadmap: Roadmap, evidence: Readonly<Record<string, FeatureEvidence>>, nowMs: number): Health {
  const days = untouchedDays(roadmap, evidence, nowMs)
  const needsYou = roadmap.features.filter(feature => feature.status === 'blocked' && feature.blocked_on === 'you').length
  const inProgress = roadmap.features.filter(feature => feature.status === 'in_progress')
  const moving = inProgress.filter(feature => !isStale(feature, evidence[feature.id]?.last_change ?? null, nowMs))

  if (days !== null && days >= STALLED_DAYS) return { kind: 'stalled', label: 'Stalled', detail: `Untouched ${days} days` }
  if (needsYou > 0) return { kind: 'needs_you', label: 'Needs you', detail: `${needsYou} waiting on you` }
  if (inProgress.length > 0 && moving.length === 0) return { kind: 'stalled', label: 'Stalled', detail: 'Work in progress has gone stale' }
  if (days === null) return { kind: 'unknown', label: 'Unknown', detail: 'Last activity unknown' }
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

/** What the deployed app said: a status when it answered; no status when it couldn't be reached. */
export type LiveAnswer = { ok: boolean | null; status: number | null }

/**
 * Whether the deployed app is up, as far as anyone can tell: only an answer can
 * say. No answer (this machine offline, DNS, a refused connection) is unknown,
 * null. A status of 0 is how an earlier version wrote no answer.
 */
export const liveAnswer = (live: LiveAnswer): boolean | null => (live.status ? live.ok : null)

export type Alert = { kind: 'broke' | 'down' | 'rabbit' | 'stale' | 'quiet'; label: string; text: string }

/**
 * What's wrong, worst first: features that broke, the deployed app down, rabbit
 * holes, stale work, a project left alone. Empty when nothing is: the strip hides.
 */
export function alertsOf(
  roadmap: Roadmap,
  evidence: Readonly<Record<string, FeatureEvidence>>,
  live: LiveAnswer | null,
  nowMs: number,
): Alert[] {
  const alerts: Alert[] = []
  for (const feature of roadmap.features) {
    if (feature.regressed === null || feature.status === 'parked') continue
    const reason = feature.regressed.reason === 'tests fail' ? `Tests fail since ${ago(feature.regressed.at, nowMs)}.` : `${capital(feature.regressed.reason)}.`
    alerts.push({ kind: 'broke', label: 'Broke', text: `${feature.title}. ${reason}` })
  }
  if (live && liveAnswer(live) === false) alerts.push({ kind: 'down', label: 'Down', text: `Deployed app answers ${live.status}.` })
  for (const hole of rabbitHoles(roadmap)) {
    alerts.push({ kind: 'rabbit', label: 'Rabbit hole', text: `${hole.feature.title}. ${hole.sessions} sessions, no progress.` })
  }
  for (const feature of roadmap.features) {
    const lastChange = evidence[feature.id]?.last_change ?? null
    if (isStale(feature, lastChange, nowMs)) {
      const touched = new Date(lastTouchedMs(feature, lastChange) ?? nowMs).toISOString()
      alerts.push({ kind: 'stale', label: 'Stale', text: `${feature.title}. In progress, untouched ${ago(touched, nowMs).replace(' ago', '')}.` })
    }
  }
  const days = untouchedDays(roadmap, evidence, nowMs)
  if (days !== null && days >= STALLED_DAYS) alerts.push({ kind: 'quiet', label: 'Untouched', text: `${days} days. Pick it up or park it.` })
  return alerts
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** A pull request or branch merged on the main line, with the features whose files it changed. */
export type MergedWork = { at: string; pr: number | null; features: readonly string[] }

/**
 * Features added and finished in the last 7 days: is scope growing faster than
 * work gets done? Finished counts a status that became done, and a built
 * feature whose files a merged pull request changed: merged work is done work.
 */
export function scopeWeek(roadmap: Roadmap, nowMs: number, merged: readonly MergedWork[] = []): { added: string[]; done: string[]; merges: number[] } {
  const since = new Date(nowMs - 7 * DAY).toISOString()
  const recent = roadmap.recent_changes.filter(change => change.at >= since)
  const titles = (pick: (change: (typeof recent)[number]) => boolean) => [...new Map(recent.filter(pick).map(change => [change.id, change.title])).values()]
  const thisWeek = merged.filter(merge => Date.parse(merge.at) >= nowMs - 7 * DAY)
  const touched = new Set(thisWeek.flatMap(merge => merge.features))
  const builtByMerge = roadmap.features.filter(feature => touched.has(feature.id) && !feature.idea && isBuilt(feature)).map(feature => feature.title)
  return {
    added: titles(change => change.field === 'added'),
    done: [...new Set([...titles(change => change.field === 'status' && change.to === 'done'), ...builtByMerge])],
    merges: thisWeek.flatMap(merge => (merge.pr === null ? [] : [merge.pr])).sort((a, b) => a - b),
  }
}

/** "12 PRs merged (#371–#382)", or "" when none were. */
export function mergedLine(prs: readonly number[]): string {
  if (prs.length === 0) return ''
  const range = prs.length === 1 ? `#${prs[0]}` : `#${prs[0]}–#${prs[prs.length - 1]}`
  return `${prs.length} PR${prs.length === 1 ? '' : 's'} merged (${range})`
}

/**
 * Of the planned features, the share whose latest code is in the deployed
 * commit. Null when nothing says which commit is deployed: unknown, not 0%.
 */
export function liveOf(roadmap: Roadmap, evidence: Readonly<Record<string, FeatureEvidence>>): { live: number | null; count: number; planned: number } {
  const planned = roadmap.features.filter(feature => !feature.idea)
  const known = planned.some(feature => typeof evidence[feature.id]?.live === 'boolean')
  const count = planned.filter(feature => isBuilt(feature) && evidence[feature.id]?.live === true).length
  return { live: known && planned.length > 0 ? Math.round((count / planned.length) * 100) : null, count, planned: planned.length }
}

const SHORT_DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** "13 Oct". */
export const shortDate = (iso: string) => SHORT_DATE.format(new Date(iso))

/** A short progress report for the week, to paste anywhere: at most five lines. */
export function weeklySummary(roadmap: Roadmap, evidence: Readonly<Record<string, FeatureEvidence>>, nowMs: number, merged: readonly MergedWork[] = []): string {
  const now = new Date(nowMs)
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)))
  const overall = progress(roadmap).overall
  const weekAgo = new Date(nowMs - 7 * DAY).toISOString().slice(0, 10)
  // Only a day measured the same way: older entries averaged UI and works.
  const before = [...roadmap.progress_log].reverse().find(entry => entry.day <= weekAgo && entry.measure === 'built')?.overall
  const delta = overall !== null && typeof before === 'number' && overall !== before ? ` (${overall > before ? '+' : ''}${overall - before})` : ''
  const week = scopeWeek(roadmap, nowMs, merged)
  const merges = mergedLine(week.merges)
  const waiting = roadmap.features.filter(feature => feature.status === 'blocked' && feature.blocked_on === 'you')
  const broke = roadmap.features.filter(feature => feature.regressed !== null)
  const next = nextUp(roadmap)
  const list = (items: readonly string[], limit: number) => items.slice(0, limit).join(', ') + (items.length > limit ? ` +${items.length - limit}` : '')

  return [
    `${roadmap.name} · week of ${shortDate(monday.toISOString())}`,
    `Built ${overall === null ? 'unknown' : `${overall}%`}${delta}. Done: ${week.done.length > 0 ? list(week.done, 3) : 'nothing'}${merges ? `; ${merges}` : ''}.`,
    waiting.length > 0 ? `Waiting on you: ${waiting.length} (${list(waiting.map(feature => feature.title), 3)}).` : '',
    broke.length > 0 ? `Broke: ${list(broke.map(feature => feature.title), 3)}.` : '',
    next ? `Next: ${next.title}.` : '',
  ]
    .filter(Boolean)
    .join('\n')
}
