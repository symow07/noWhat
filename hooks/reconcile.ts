// From evidence to states: the rules that keep the roadmap current without anyone
// typing a status. Pure. Every change it makes is logged with source "detected",
// and it only moves a state on concrete evidence: unknown never downgrades.

import type { FeatureEvidence } from './detect'
import { type Change, type ChangeField, type Feature, type Roadmap, type Status, STALE_DAYS, keepChanges } from './schema'

/** Files changed within this many days mean planned work has started. */
export const STARTED_DAYS = 3

export type Evidence = Record<string, FeatureEvidence>

const DAY = 86_400_000

/** The feature has code: a source file of its exists. */
export const hasCode = (ev: FeatureEvidence) => ev.files.some(file => file.exists && file.wired !== null)

const changedWithin = (ev: FeatureEvidence, nowMs: number, days: number) =>
  ev.uncommitted || (ev.last_change !== null && nowMs - Date.parse(ev.last_change) < days * DAY)

/** Proven working: every source file exists and is wired, its tests pass, and nothing it needs is missing. */
export function isHealthy(ev: FeatureEvidence): boolean {
  const code = ev.files.filter(file => file.wired !== null)
  return code.length > 0 && code.every(file => file.exists && file.wired === true) && ev.tests_status === 'pass' && ev.env_missing.length === 0
}

/**
 * The status a feature starts with when nobody gave one: no code is not
 * started; healthy is done; code moving this week is in progress; older code
 * nobody proved is done, and shows as unverified until something proves it.
 */
export function initialStatus(ev: FeatureEvidence | undefined, nowMs: number): Status {
  if (!ev || !hasCode(ev)) return 'not_started'
  if (isHealthy(ev)) return 'done'
  if (changedWithin(ev, nowMs, STALE_DAYS)) return 'in_progress'
  return 'done'
}

/** The signals the dashboard shows beside a feature, worst first. */
export function signalsOf(ev: FeatureEvidence | undefined): string[] {
  if (!ev) return []
  const signals: string[] = []
  if (ev.env_missing.length > 0) signals.push(`needs ${ev.env_missing.slice(0, 2).join(', ')}${ev.env_missing.length > 2 ? '…' : ''}`)
  if (ev.tests_status === 'fail') signals.push('tests failing')
  const unwired = ev.files.filter(file => file.exists && file.wired === false).length
  if (unwired > 0) signals.push('not wired in')
  if (ev.files.length > 0 && ev.files.every(file => !file.exists)) signals.push('files missing')
  const markers = ev.files.reduce((sum, file) => sum + file.markers, 0)
  if (markers > 0) signals.push(`${markers} TODO${markers === 1 ? '' : 's'}`)
  return signals
}

/**
 * Applies evidence to the roadmap. The rules, in order:
 * 1. UI: a reachable screen makes a feature at least "designed". Polish is never taken away.
 * 2. Functional: code makes it at least "partial"; healthy makes it "working" (verified by
 *    tests); failing tests, or a file nothing references any more, take "working" back.
 *    All its files gone takes it to "none".
 * 3. Started: a not-started or queued feature whose own files (none it shares with another
 *    feature) changed in STARTED_DAYS days is in progress.
 * 4. Config: required env vars missing on the deploy target block it on the user; when they
 *    appear, the block detection made lifts and the status it had comes back.
 * 5. Regression: "working" taken away marks the feature as broke, with why; working again clears it.
 * A pinned feature is left exactly as the person set it, and a parked one keeps its status.
 * A feature whose files all belong to other features too is left alone: their
 * evidence can't tell it apart (a planned chart on a shared home screen isn't
 * proven by the home screen's tests).
 */
export function reconcile(roadmap: Roadmap, evidence: Evidence, now: string): { roadmap: Roadmap; changes: Change[] } {
  const nowMs = Date.parse(now)
  const changes: Change[] = []
  const owners = new Map<string, number>()
  for (const feature of roadmap.features) for (const path of feature.related_files) owners.set(path, (owners.get(path) ?? 0) + 1)
  const isOwn = (path: string) => owners.get(path) === 1

  const features = roadmap.features.map(original => {
    const ev = evidence[original.id]
    if (!ev || original.related_files.length === 0 || original.pinned) return original
    if (!original.related_files.some(isOwn)) return original
    const holdsStatus = original.status === 'parked'
    const feature: Feature = { ...original }
    const log = (field: ChangeField, from: string | null, to: string | null) =>
      changes.push({ at: now, id: feature.id, title: feature.title, field, from, to, source: 'detected' })
    const setFunctional = (to: Feature['functional_state'], verified: Feature['verified_by']) => {
      log('functional_state', feature.functional_state, to)
      feature.functional_state = to
      feature.verified_by = verified
    }
    const setStatus = (to: Status) => {
      log('status', feature.status, to)
      feature.status = to
    }
    const code = hasCode(ev)

    if (feature.kind === 'ui' && feature.ui_state === 'none' && ev.files.some(file => file.screen && file.wired === true)) {
      log('ui_state', 'none', 'designed')
      feature.ui_state = 'designed'
    }

    const broke = (reason: string) => {
      setFunctional('partial', null)
      feature.regressed = { at: now, reason }
    }
    if (!code) {
      if (feature.functional_state !== 'none' && ev.files.length > 0 && ev.files.every(file => !file.exists)) setFunctional('none', null)
    } else {
      if (feature.functional_state === 'none') setFunctional('partial', null)
      if (ev.tests_status === 'fail' && feature.functional_state === 'working') broke('tests fail')
      else if (isHealthy(ev) && feature.functional_state !== 'working') {
        setFunctional('working', 'tests')
        feature.regressed = null
      } else if (feature.functional_state === 'working' && feature.verified_by === 'tests' && ev.files.some(file => file.exists && file.wired === false)) {
        broke('a file is no longer wired in')
      }
    }

    const ownFilesMoved = ev.files.some(
      file => isOwn(file.path) && (file.uncommitted || (file.last_change !== null && nowMs - Date.parse(file.last_change) < STARTED_DAYS * DAY)),
    )
    if ((feature.status === 'not_started' || feature.status === 'queued') && code && ownFilesMoved) setStatus('in_progress')

    if (holdsStatus) {
      // Parked by a decision: detection updates its states, never its status.
    } else if (ev.env_missing.length > 0 && ev.env_source !== null) {
      const reason = `Missing in ${ev.env_source}: ${ev.env_missing.join(', ')}`
      if (feature.status !== 'blocked') {
        const from = feature.status
        setStatus('blocked')
        feature.blocked_on = 'you'
        feature.blocker_reason = reason
        feature.auto_blocked = { from }
      } else if (feature.auto_blocked) feature.blocker_reason = reason
    } else if (feature.auto_blocked && (ev.env_source !== null || ev.env_required.length === 0)) {
      const back = feature.auto_blocked.from
      setStatus(back)
      feature.blocked_on = null
      feature.blocker_reason = null
      feature.auto_blocked = null
    }

    if (changes.some(change => change.id === feature.id)) feature.progress_at = now
    return feature
  })

  if (changes.length === 0) return { roadmap, changes }

  return {
    roadmap: { ...roadmap, features, recent_changes: keepChanges([...[...changes].reverse(), ...roadmap.recent_changes], now) },
    changes,
  }
}
