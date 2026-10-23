// From evidence to states: the rules that keep the roadmap current without anyone
// typing a status. Pure. Every change it makes is logged with source "detected",
// and it only moves a state on concrete evidence: unknown never downgrades.

import { type FeatureEvidence, type FileEvidence, LOCAL_ENV } from './detect'
import { type Change, type ChangeField, type Feature, type Roadmap, type Status, type Verification, STALE_DAYS, keepChanges } from './schema'

/** Files changed within this many days mean planned work has started. */
export const STARTED_DAYS = 3

export type Evidence = Record<string, FeatureEvidence>

const DAY = 86_400_000

/** A source file of the feature's: evidence written before `code` existed said so by being wired or not. */
const isCode = (file: FileEvidence) => file.code ?? file.wired !== null

/** The feature has code: a source file of its exists. */
export const hasCode = (ev: FeatureEvidence) => ev.files.some(file => file.exists && isCode(file))

const changedWithin = (ev: FeatureEvidence, nowMs: number, days: number) =>
  ev.uncommitted || (ev.last_change !== null && nowMs - Date.parse(ev.last_change) < days * DAY)

/**
 * How the evidence proves the feature works, strongest first: its own tests
 * pass; the suite passes and a coverage report saw its code run; the suite
 * passes and none of its tests map to it (built, tests not mapped). Null when
 * nothing proves it. A signal that couldn't be read (wiring nobody could
 * check, tests that never ran) never counts against it: only a file seen
 * unreferenced, a failing test or a missing key does.
 */
export function provenBy(ev: FeatureEvidence): Extract<Verification, 'tests' | 'coverage' | 'suite'> | null {
  const code = ev.files.filter(isCode)
  if (code.length === 0 || code.some(file => !file.exists || file.wired === false) || ev.env_missing.length > 0) return null
  if (ev.tests_status === 'fail') return null
  if (ev.tests_status === 'pass') return 'tests'
  if (ev.suite !== 'pass') return null
  return (ev.coverage ?? 0) > 0 ? 'coverage' : 'suite'
}

/** Proven working by its own tests. */
export const isHealthy = (ev: FeatureEvidence) => provenBy(ev) === 'tests'

/**
 * The status a feature starts with when nobody gave one: no code is not
 * started; proven is done; code moving this week is in progress; older code
 * nobody proved is done, and shows as unconfirmed until something proves it.
 */
export function initialStatus(ev: FeatureEvidence | undefined, nowMs: number): Status {
  if (!ev || !hasCode(ev)) return 'not_started'
  if (provenBy(ev) !== null) return 'done'
  if (changedWithin(ev, nowMs, STALE_DAYS)) return 'in_progress'
  return 'done'
}

/** Whether Claude or a person set this status: detection then keeps it. */
function isRecorded(roadmap: Roadmap, feature: Feature): boolean {
  if (feature.status_by !== null) return feature.status_by === 'claude'
  // Older files: the latest logged change of its status says who.
  const last = roadmap.recent_changes.find(change => change.id === feature.id && change.field === 'status')
  return last !== undefined && last.source !== 'detected'
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
 * 2. Functional: code makes it at least "partial"; proven (provenBy) makes it "working",
 *    verified by tests, coverage or the suite; failing tests, or a file seen unreferenced,
 *    take "working" back. All its files gone takes it to "none".
 * 3. Started: a not-started or queued feature whose own files (none it shares with another
 *    feature) changed in STARTED_DAYS days is in progress. Finished: an in-progress feature
 *    that is proven and has no uncommitted edits is done, unless Claude set it in progress.
 * 4. Config: required env vars missing on the deploy target block it on the user; when they
 *    appear, the block detection made lifts and the status it had comes back. A block read
 *    off the local .env lifts once the deploy host is what's checked (or nothing can be).
 * 5. Regression: "working" taken away marks the feature as broke, with why; working again clears it.
 * A pinned feature is left exactly as the person set it, and a parked one keeps its status.
 * Done is never taken back: recorded done with nothing proving it shows as unconfirmed.
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
      feature.status_by = 'detected'
    }
    const code = hasCode(ev)
    const proof = provenBy(ev)

    // A screen that exists and wasn't seen unreferenced: unknown wiring doesn't hide it.
    if (feature.kind === 'ui' && feature.ui_state === 'none' && ev.files.some(file => file.screen && file.exists && file.wired !== false)) {
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
      else if (proof !== null && feature.functional_state !== 'working') {
        setFunctional('working', proof)
        feature.regressed = null
      } else if (
        feature.functional_state === 'working' &&
        (feature.verified_by === 'tests' || feature.verified_by === 'coverage' || feature.verified_by === 'suite') &&
        ev.files.some(file => file.exists && file.wired === false)
      ) {
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
        feature.auto_blocked = { from, source: ev.env_source }
      } else if (feature.auto_blocked) {
        feature.blocker_reason = reason
        feature.auto_blocked = { ...feature.auto_blocked, source: ev.env_source }
      }
    } else if (
      feature.auto_blocked &&
      (ev.env_source !== null || ev.env_required.length === 0 || (blockedFrom(feature) === LOCAL_ENV && ev.env_source !== LOCAL_ENV))
    ) {
      const back = feature.auto_blocked.from
      setStatus(back)
      feature.blocked_on = null
      feature.blocker_reason = null
      feature.auto_blocked = null
    }

    // Proven and nothing in flight: finished, unless Claude said it's still in progress.
    if (!holdsStatus && feature.status === 'in_progress' && proof !== null && !ev.uncommitted && !isRecorded(roadmap, original)) setStatus('done')

    if (changes.some(change => change.id === feature.id)) feature.progress_at = now
    return feature
  })

  if (changes.length === 0) return { roadmap, changes }


  return {
    roadmap: { ...roadmap, features, recent_changes: keepChanges([...[...changes].reverse(), ...roadmap.recent_changes], now) },
    changes,
  }
}

/** Where a detected block's missing names were read: recorded since 0.4, read off its reason before. */
function blockedFrom(feature: Feature): string | null {
  return feature.auto_blocked?.source ?? /^Missing in (.+?): /.exec(feature.blocker_reason ?? '')?.[1] ?? null
}
