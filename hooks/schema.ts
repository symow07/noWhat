// The .claude/nowhat.json format: its types, validation, progress maths and edits.
// Pure functions with no `$`, so the tests run them directly.

/** The version this plugin writes. Version 1 files are read and upgraded in place. */
export const SCHEMA_VERSION = 2

export const STATUSES = ['queued', 'not_started', 'in_progress', 'blocked', 'parked', 'done'] as const
export const UI_STATES = ['none', 'designed', 'polished'] as const
export const FUNCTIONAL_STATES = ['none', 'partial', 'working'] as const
export const KINDS = ['ui', 'logic'] as const
/** How "working" was confirmed: Claude ran it, its tests pass, or the user said so. */
export const VERIFICATIONS = ['ran', 'tests', 'user'] as const
/** Who a blocked feature waits on: the user (keys, accounts, a decision) or more code. */
export const BLOCKERS = ['you', 'code'] as const

export type Status = (typeof STATUSES)[number]
export type UiState = (typeof UI_STATES)[number]
export type FunctionalState = (typeof FUNCTIONAL_STATES)[number]
export type Kind = (typeof KINDS)[number]
export type Verification = (typeof VERIFICATIONS)[number]
export type BlockedOn = (typeof BLOCKERS)[number]

/** How much each state counts toward progress. Change these to re-weight. */
export const WEIGHTS: {
  ui: Record<UiState, number>
  functional: Record<FunctionalState, number>
} = {
  ui: { none: 0, designed: 0.5, polished: 1 },
  functional: { none: 0, partial: 0.5, working: 1 },
}

/** Statuses that count as 0 whatever their states say. */
export const ZERO_STATUSES: readonly Status[] = ['queued', 'not_started']

/** In progress with nothing touching it for this many days: stale. */
export const STALE_DAYS = 7

/**
 * Generated text is a status board, not prose: these caps keep every note,
 * reason and summary to a headline and facts. The update tool refuses longer.
 */
export const TEXT_LIMITS = { note: 280, note_lines: 4, where_i_left_off: 200, reason: 140, decision: 160, idea: 80 } as const

/** Blocker reasons that wait on the person: keys, accounts, purchases, sign-ins, decisions. */
const NEEDS_YOU =
  /\b(env|key|keys|api key|secret|token|dsn|credentials?|password|account|sign[- ]?in|log ?in|purchase|buy|billing|domain|dns|app store|play console|testflight|approval|decision|decide|owner|variables?|store products|missing in|railway|vercel|eas|netlify|fly\.io|revenuecat|stripe|plaid)\b/i

/** Who a blocker waits on, from its reason when nobody said: the person, or more code. */
export const inferBlockedOn = (reason: string | null): BlockedOn => (reason !== null && NEEDS_YOU.test(reason) ? 'you' : 'code')

/**
 * The change log keeps every change of the last CHANGES_DAYS days (at least
 * RECENT_CHANGES_KEPT, at most CHANGES_MAX): enough for "since your last
 * visit" after a long break and for the week's scope meter.
 */
export const RECENT_CHANGES_KEPT = 20
export const CHANGES_DAYS = 35
export const CHANGES_MAX = 400
export const RELATED_FILES_KEPT = 25
/** Sessions remembered per feature, for the rabbit-hole warning. */
export const SESSIONS_KEPT = 12
export const DECISIONS_KEPT = 100
/** Days of daily progress kept, for the weekly summary's change. */
export const PROGRESS_DAYS = 35
/** Files reviewed and left out of every feature, so they stop showing as unsorted. */
export const IGNORED_FILES_KEPT = 500

/** The change log trimmed to what it keeps: newest first. */
export function keepChanges(changes: readonly Change[], now: string): Change[] {
  const cutoff = Date.parse(now) - CHANGES_DAYS * 86_400_000
  return changes.filter((change, index) => index < RECENT_CHANGES_KEPT || Date.parse(change.at) >= cutoff).slice(0, CHANGES_MAX)
}

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/

export type Conversation = { session_id: string; title: string | null; at: string }

export type Milestone = { id: string; title: string }

/** One key choice and why, as Claude records it while working: "Polling, because push needs a verified app". */
export type Decision = { at: string; text: string; feature: string | null }

/** A session that worked on a feature: Claude updated it, or filed edits under it. */
export type SessionMark = { id: string; at: string }

export type Feature = {
  id: string
  title: string
  description: string
  kind: Kind
  status: Status
  /** Null, and left out of the file, for a `logic` feature: it has no UI. */
  ui_state: UiState | null
  functional_state: FunctionalState
  /** How `working` was confirmed; null unless functional_state is working. */
  verified_by: Verification | null
  blocker_reason: string | null
  /** Who a blocked feature waits on; null unless blocked. */
  blocked_on: BlockedOn | null
  /** Set when detection blocked it (missing config): detection lifts it again, back to `from`. */
  auto_blocked: { from: Status } | null
  milestone: string | null
  /** Catch-up note Claude keeps: terse facts, at most TEXT_LIMITS.note_lines lines. */
  note: string
  /** Why it was parked, when status is parked. */
  parked_reason: string | null
  /** Features it can't move on until they're done. */
  depends_on: string[]
  /** Detection never changes a pinned feature: what the person set stays. */
  pinned: boolean
  related_files: string[]
  /** Env var names it can't work without, beyond what its own files read (a shared config module's keys). */
  needs_config: string[]
  last_conversation: Conversation | null
  thumbnail: string | null
  updated_at: string
  /** Captured from the sidebar and not planned yet: listed in the backlog, left out of progress. */
  idea: boolean
  /** The sessions that worked on it, oldest first. */
  sessions: SessionMark[]
  /** When its status, UI or functional state last changed; sessions after this made no progress. */
  progress_at: string | null
  /** Set when detection took "working" away (tests fail, a file came unwired); cleared when it works again. */
  regressed: { at: string; reason: string } | null
}

export type ChangeField = 'status' | 'ui_state' | 'functional_state' | 'added' | 'removed'

/** One line of the recent-changes log, newest first in the file. */
export type Change = {
  at: string
  id: string
  title: string
  field: ChangeField
  from: string | null
  to: string | null
  /** `claude` through the tool; `you` from the sidebar; `outside` when the file changed some other way; `detected` from evidence. */
  source: 'claude' | 'you' | 'outside' | 'detected'
}

export type Roadmap = {
  schema_version: typeof SCHEMA_VERSION
  /** Stable across moves and renames: how the all-projects list knows a project that moved. */
  project_id: string | null
  name: string
  last_touched: string
  where_i_left_off: string
  left_off_at: string | null
  /** When the last sort (Sort with Claude) reconciled the file with git, and the commit it reached. */
  synced_at: string | null
  synced_commit: string | null
  milestones: Milestone[]
  features: Feature[]
  recent_changes: Change[]
  /** Newest first. */
  decisions: Decision[]
  /** One overall percentage per day, oldest first. */
  progress_log: { day: string; overall: number | null }[]
  /** Files (or folders) a sort left out of every feature on purpose: never listed as unsorted. */
  ignored_files: string[]
}

export type Checked = { roadmap: Roadmap; errors: [] } | { roadmap: null; errors: string[] }

type Loose = Record<string, unknown>

const isObject = (value: unknown): value is Loose =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
  errors: string[],
): T | null {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T
  errors.push(`${label} is ${JSON.stringify(value)}; use one of ${allowed.join(', ')}`)
  return null
}

function conversationOf(value: unknown): Conversation | null {
  if (!isObject(value)) return null
  const id = text(value.session_id)
  const at = text(value.at)

  return id && at ? { session_id: id, title: text(value.title), at } : null
}

/** What "working" needs from Claude, said the same way by validation and the update tool. */
export const WORKING_NEEDS =
  'working needs verified_by: ran (you ran it), tests (its tests pass) or user (the user said so). Unconfirmed, keep functional_state partial: a done feature then shows as unverified'

const LOGIC_HAS_NO_UI = 'kind "logic" has no UI: leave ui_state out'

/** `strict` is for Claude's own input: "working" must say how it was confirmed. */
export type ValidateOptions = { strict?: boolean }

function checkFeature(raw: unknown, now: string, at: string, errors: string[], options: ValidateOptions): Feature | null {
  if (!isObject(raw)) {
    errors.push(`${at}: must be an object`)
    return null
  }
  const id = text(raw.id) ?? ''
  const where = id ? `${at} (${id})` : at
  const before = errors.length

  if (!ID.test(id)) errors.push(`${where}: id must be kebab-case (a-z, 0-9, -), up to 64 characters`)
  const title = text(raw.title)
  if (!title) errors.push(`${where}: title is missing`)
  const kind = oneOf(raw.kind ?? 'ui', KINDS, `${where}: kind`, errors)
  const status = oneOf(raw.status, STATUSES, `${where}: status`, errors)
  let ui: UiState | null = null
  if (kind === 'ui') ui = oneOf(raw.ui_state ?? 'none', UI_STATES, `${where}: ui_state`, errors)
  else if (raw.ui_state !== undefined && raw.ui_state !== null && raw.ui_state !== 'none') {
    errors.push(`${where}: ${LOGIC_HAS_NO_UI}`)
  }
  const functional = oneOf(raw.functional_state ?? 'none', FUNCTIONAL_STATES, `${where}: functional_state`, errors)
  const verified =
    raw.verified_by === undefined || raw.verified_by === null
      ? null
      : oneOf(raw.verified_by, VERIFICATIONS, `${where}: verified_by`, errors)
  if (options.strict && functional === 'working' && verified === null) errors.push(`${where}: ${WORKING_NEEDS}`)
  const blocker = text(raw.blocker_reason)
  if (status === 'blocked' && !blocker) errors.push(`${where}: a blocked feature needs a blocker_reason`)
  const blockedOn =
    raw.blocked_on === undefined || raw.blocked_on === null ? null : oneOf(raw.blocked_on, BLOCKERS, `${where}: blocked_on`, errors)
  const files = raw.related_files ?? []
  const isFileList = Array.isArray(files) && files.every(file => typeof file === 'string')
  if (!isFileList) errors.push(`${where}: related_files must be a list of paths`)
  const config = raw.needs_config ?? []
  const isConfigList = Array.isArray(config) && config.every(name => typeof name === 'string' && /^[A-Z][A-Z0-9_]*$/.test(name))
  if (!isConfigList) errors.push(`${where}: needs_config must be a list of env var names (UPPER_SNAKE)`)
  const autoFrom = isObject(raw.auto_blocked) && typeof raw.auto_blocked.from === 'string' ? raw.auto_blocked.from : null
  const parked = text(raw.parked_reason)
  if (status === 'parked' && !parked) errors.push(`${where}: a parked feature needs a parked_reason`)
  const depends = raw.depends_on ?? []
  const isDependsList = Array.isArray(depends) && depends.every(one => typeof one === 'string')
  if (!isDependsList) errors.push(`${where}: depends_on must be a list of feature ids`)

  if (errors.length > before || !title || !kind || !status || !functional || !isFileList || !isConfigList || !isDependsList) return null
  if (kind === 'ui' && ui === null) return null
  const isBlocked = status === 'blocked'

  return {
    id,
    title,
    description: text(raw.description) ?? '',
    kind,
    status,
    ui_state: ui,
    functional_state: functional,
    verified_by: functional === 'working' ? verified : null,
    blocker_reason: isBlocked ? blocker : null,
    blocked_on: isBlocked ? (blockedOn ?? inferBlockedOn(blocker)) : null,
    auto_blocked:
      isBlocked && autoFrom !== null && (STATUSES as readonly string[]).includes(autoFrom) ? { from: autoFrom as Status } : null,
    milestone: text(raw.milestone),
    related_files: [...new Set(files as string[])],
    needs_config: [...new Set(config as string[])],
    note: typeof raw.note === 'string' ? raw.note.trim() : '',
    parked_reason: status === 'parked' ? parked : null,
    depends_on: [...new Set(depends as string[])].filter(one => one !== id),
    pinned: raw.pinned === true,
    last_conversation: conversationOf(raw.last_conversation),
    thumbnail: text(raw.thumbnail),
    updated_at: text(raw.updated_at) ?? now,
    idea: raw.idea === true,
    sessions: sessionsOf(raw.sessions),
    progress_at: text(raw.progress_at),
    regressed:
      isObject(raw.regressed) && text(raw.regressed.at) && text(raw.regressed.reason)
        ? { at: text(raw.regressed.at) as string, reason: text(raw.regressed.reason) as string }
        : null,
  }
}

function sessionsOf(value: unknown): SessionMark[] {
  if (!Array.isArray(value)) return []
  return value
    .flatMap(item => (isObject(item) && text(item.id) && text(item.at) ? [{ id: text(item.id) as string, at: text(item.at) as string }] : []))
    .slice(-SESSIONS_KEPT)
}

function decisionsOf(value: unknown): Decision[] {
  if (!Array.isArray(value)) return []
  return value
    .flatMap(item => (isObject(item) && text(item.at) && text(item.text) ? [{ at: text(item.at) as string, text: text(item.text) as string, feature: text(item.feature) }] : []))
    .slice(0, DECISIONS_KEPT)
}

function progressLogOf(value: unknown): Roadmap['progress_log'] {
  if (!Array.isArray(value)) return []
  return value
    .flatMap(item =>
      isObject(item) && typeof item.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.day)
        ? [{ day: item.day, overall: typeof item.overall === 'number' ? item.overall : null }]
        : [],
    )
    .slice(-PROGRESS_DAYS)
}

function changeOf(value: unknown): Change | null {
  if (!isObject(value)) return null
  const fields: readonly string[] = ['status', 'ui_state', 'functional_state', 'added', 'removed']
  const at = text(value.at)
  const id = text(value.id)
  const field = typeof value.field === 'string' && fields.includes(value.field) ? (value.field as ChangeField) : null
  if (!at || !id || !field) return null
  const source = value.source === 'outside' || value.source === 'detected' || value.source === 'you' ? value.source : 'claude'

  return { at, id, title: text(value.title) ?? id, field, from: text(value.from), to: text(value.to), source }
}

function milestonesOf(value: unknown, errors: string[]): Milestone[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    errors.push('milestones must be a list of { id, title }')
    return []
  }
  const milestones: Milestone[] = []
  for (const [index, item] of value.entries()) {
    const id = isObject(item) ? text(item.id) : null
    const title = isObject(item) ? text(item.title) : null
    if (!id || !ID.test(id) || !title) errors.push(`milestones[${index}]: needs a kebab-case id and a title`)
    else if (!milestones.some(one => one.id === id)) milestones.push({ id, title })
  }
  return milestones
}

/** Checks a parsed roadmap.json, filling optional fields; refuses it whole on any error. */
export function validate(raw: unknown, now: string, options: ValidateOptions = {}): Checked {
  if (!isObject(raw)) return { roadmap: null, errors: ['the file must hold a JSON object'] }
  const errors: string[] = []

  const version = raw.schema_version ?? SCHEMA_VERSION
  if (version !== 1 && version !== SCHEMA_VERSION) {
    errors.push(`schema_version ${JSON.stringify(version)} is not supported (this plugin reads 1 and ${SCHEMA_VERSION})`)
  }
  const name = text(raw.name)
  if (!name) errors.push('name is missing')
  if (!Array.isArray(raw.features)) errors.push('features must be a list')
  const milestones = milestonesOf(raw.milestones, errors)

  const features: Feature[] = []
  const seen = new Set<string>()
  for (const [index, item] of (Array.isArray(raw.features) ? raw.features : []).entries()) {
    const feature = checkFeature(item, now, `features[${index}]`, errors, options)
    if (!feature) continue
    if (seen.has(feature.id)) errors.push(`features[${index}]: id "${feature.id}" is used twice`)
    if (feature.milestone !== null && !milestones.some(milestone => milestone.id === feature.milestone)) {
      errors.push(`features[${index}] (${feature.id}): milestone "${feature.milestone}" isn't in milestones`)
    }
    seen.add(feature.id)
    features.push(feature)
  }

  for (const feature of features) {
    for (const dependency of feature.depends_on) {
      if (!seen.has(dependency)) errors.push(`${feature.id}: depends_on "${dependency}" is not a feature`)
    }
  }

  if (errors.length > 0 || !name) return { roadmap: null, errors }

  const changes = Array.isArray(raw.recent_changes) ? raw.recent_changes : []

  return {
    roadmap: {
      schema_version: SCHEMA_VERSION,
      project_id: text(raw.project_id),
      name,
      last_touched: text(raw.last_touched) ?? now,
      where_i_left_off: text(raw.where_i_left_off) ?? '',
      left_off_at: text(raw.left_off_at),
      synced_at: text(raw.synced_at),
      synced_commit: text(raw.synced_commit),
      milestones,
      features,
      recent_changes: keepChanges(
        changes.map(changeOf).filter((change): change is Change => change !== null),
        now,
      ),
      decisions: decisionsOf(raw.decisions),
      progress_log: progressLogOf(raw.progress_log),
      ignored_files: Array.isArray(raw.ignored_files)
        ? [...new Set(raw.ignored_files.filter((path): path is string => typeof path === 'string' && path !== ''))].slice(0, IGNORED_FILES_KEPT)
        : [],
    },
    errors: [],
  }
}

/** The file's text, keys in a fixed order so diffs stay readable. */
export function serialize(roadmap: Roadmap): string {
  const features = roadmap.features.map(feature => ({
    id: feature.id,
    title: feature.title,
    description: feature.description,
    kind: feature.kind,
    milestone: feature.milestone,
    ...(feature.pinned ? { pinned: true } : {}),
    status: feature.status,
    ...(feature.kind === 'ui' ? { ui_state: feature.ui_state } : {}),
    functional_state: feature.functional_state,
    verified_by: feature.verified_by,
    blocker_reason: feature.blocker_reason,
    blocked_on: feature.blocked_on,
    ...(feature.auto_blocked ? { auto_blocked: feature.auto_blocked } : {}),
    related_files: feature.related_files,
    needs_config: feature.needs_config,
    depends_on: feature.depends_on,
    note: feature.note,
    parked_reason: feature.parked_reason,
    last_conversation: feature.last_conversation,
    thumbnail: feature.thumbnail,
    updated_at: feature.updated_at,
    ...(feature.idea ? { idea: true } : {}),
    ...(feature.sessions.length > 0 ? { sessions: feature.sessions } : {}),
    ...(feature.progress_at ? { progress_at: feature.progress_at } : {}),
    ...(feature.regressed ? { regressed: feature.regressed } : {}),
  }))

  return `${JSON.stringify(
    {
      schema_version: roadmap.schema_version,
      ...(roadmap.project_id ? { project_id: roadmap.project_id } : {}),
      name: roadmap.name,
      last_touched: roadmap.last_touched,
      where_i_left_off: roadmap.where_i_left_off,
      left_off_at: roadmap.left_off_at,
      synced_at: roadmap.synced_at,
      synced_commit: roadmap.synced_commit,
      milestones: roadmap.milestones,
      features,
      recent_changes: roadmap.recent_changes,
      decisions: roadmap.decisions,
      progress_log: roadmap.progress_log,
      ignored_files: roadmap.ignored_files,
    },
    null,
    2,
  )}\n`
}

export type Progress = {
  /** 0-100 over `ui` features; null when there are none. */
  ui: number | null
  /** 0-100 over every feature; null when there are none. */
  functional: number | null
  /** The average of the two (functional alone when there is no UI). */
  overall: number | null
  counts: Record<Status, number>
  /** Marked done, but nobody confirmed it works. */
  unverified: string[]
  /** Looks done, doesn't work yet (features still being built). */
  designedNotWorking: string[]
  /** Works, doesn't look finished yet. */
  workingNotPolished: string[]
}

const percent = (sum: number, count: number): number | null =>
  count === 0 ? null : Math.round((sum / count) * 100)

/** Progress over any set of features: the whole roadmap, or one milestone. */
export function progressOf(features: readonly Feature[]): Progress {
  const counts: Record<Status, number> = { queued: 0, not_started: 0, in_progress: 0, blocked: 0, parked: 0, done: 0 }
  let uiSum = 0
  let uiCount = 0
  let functionalSum = 0
  const unverified: string[] = []
  const designedNotWorking: string[] = []
  const workingNotPolished: string[] = []

  const planned = features.filter(feature => !feature.idea)
  for (const feature of planned) {
    counts[feature.status] += 1
    const isZero = ZERO_STATUSES.includes(feature.status)
    const isDone = feature.status === 'done'
    functionalSum += isZero ? 0 : WEIGHTS.functional[feature.functional_state]
    if (isDone && feature.functional_state !== 'working') unverified.push(feature.id)
    if (feature.kind !== 'ui') continue
    const ui = feature.ui_state ?? 'none'
    uiCount += 1
    uiSum += isZero ? 0 : WEIGHTS.ui[ui]
    if (isZero) continue
    if (!isDone && ui !== 'none' && feature.functional_state !== 'working') designedNotWorking.push(feature.id)
    if (feature.functional_state === 'working' && ui !== 'polished') workingNotPolished.push(feature.id)
  }

  const ui = percent(uiSum, uiCount)
  const functional = percent(functionalSum, planned.length)
  const overall = functional === null ? null : ui === null ? functional : Math.round((ui + functional) / 2)

  return { ui, functional, overall, counts, unverified, designedNotWorking, workingNotPolished }
}

export const progress = (roadmap: Roadmap): Progress => progressOf(roadmap.features)

/** In progress and untouched (no edit, commit or update) for STALE_DAYS days. */
export function isStale(feature: Feature, lastChange: string | null, nowMs: number): boolean {
  if (feature.status !== 'in_progress') return false
  const latest = Math.max(Date.parse(feature.updated_at) || 0, lastChange ? Date.parse(lastChange) || 0 : 0)
  return nowMs - latest >= STALE_DAYS * 86_400_000
}

/**
 * The single next thing to work on: a feature that broke, else what is already in progress (most recently
 * touched), else the head of the queue, else a code blocker, else the first
 * feature not started in the earliest unfinished milestone.
 */
export function nextUp(roadmap: Roadmap): Feature | null {
  // Something that broke comes before anything new.
  const broke = roadmap.features.filter(feature => feature.regressed !== null && feature.status !== 'parked')
  if (broke.length > 0) return broke.sort((a, b) => Date.parse(b.regressed?.at ?? '') - Date.parse(a.regressed?.at ?? ''))[0] ?? null
  const done = new Set(roadmap.features.filter(feature => feature.status === 'done').map(feature => feature.id))
  // A feature still waiting on another isn't the next thing to pick up.
  const ready = (feature: Feature) => feature.depends_on.every(id => done.has(id))
  const by = (status: Status) => roadmap.features.filter(feature => feature.status === status && (status === 'in_progress' || ready(feature)))
  const active = by('in_progress').sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0]
  if (active) return active
  const queued = by('queued')[0]
  if (queued) return queued
  const codeBlocked = by('blocked').find(feature => feature.blocked_on === 'code')
  if (codeBlocked) return codeBlocked
  const order = (feature: Feature) => {
    const index = roadmap.milestones.findIndex(milestone => milestone.id === feature.milestone)
    return index === -1 ? roadmap.milestones.length : index
  }
  return by('not_started').filter(feature => !feature.idea).sort((a, b) => order(a) - order(b))[0] ?? null
}

/** What Claude's update tool may change about one feature; an unknown id with a title adds it. */
export type FeatureChange = {
  id: string
  title?: string
  description?: string
  kind?: Kind
  status?: Status
  /** UI features only. */
  ui_state?: UiState
  functional_state?: FunctionalState
  /** Required whenever functional_state becomes working. */
  verified_by?: Verification
  blocker_reason?: string
  blocked_on?: BlockedOn
  milestone?: string | null
  /** Terse catch-up facts: what's done, what's next, the last decision. */
  note?: string
  /** Required when status becomes parked: why. */
  parked_reason?: string
  /** Replaces the ids it waits on. */
  depends_on?: string[]
  pinned?: boolean
  add_files?: string[]
  /** Replaces the env var names it needs. */
  needs_config?: string[]
}

export type UpdateInput = {
  changes?: FeatureChange[]
  where_i_left_off?: string
  /** Ids of queued features in the order to do them; unlisted queued features follow. */
  queue?: string[]
  remove?: string[]
  /** Replaces the milestone list (features keep theirs while it still exists). */
  milestones?: Milestone[]
  /** Set when the call finishes a sort: the next unsorted list starts from this commit. */
  synced?: boolean
  /** Key choices made, one line each: "X, because Y". */
  decisions?: { text: string; feature?: string }[]
  /** Unsorted files that belong to no feature: they stop showing as unsorted. */
  ignore_files?: string[]
}

export type UpdateContext = { now: string; conversation: Conversation | null; head?: string | null }

export type Applied =
  | { roadmap: Roadmap; errors: []; started: string[]; stopped: string[] }
  | { roadmap: null; errors: string[]; started: string[]; stopped: string[] }

/** Moves queued features into `order`, keeping every other feature where it stands. */
export function reorderQueue(features: readonly Feature[], order: readonly string[]): Feature[] {
  const slots = features.flatMap((feature, index) => (feature.status === 'queued' ? [index] : []))
  const queued = slots.map(slot => features[slot] as Feature)
  const rank = (feature: Feature) => {
    const listed = order.indexOf(feature.id)
    return listed === -1 ? order.length + queued.indexOf(feature) : listed
  }
  const sorted = [...queued].sort((a, b) => rank(a) - rank(b))
  const result = [...features]
  slots.forEach((slot, index) => {
    result[slot] = sorted[index] as Feature
  })

  return result
}

export function blankFeature(id: string, title: string, now: string): Feature {
  return {
    id,
    title,
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
    related_files: [],
    needs_config: [],
    note: '',
    parked_reason: null,
    depends_on: [],
    pinned: false,
    last_conversation: null,
    thumbnail: null,
    updated_at: now,
    idea: false,
    sessions: [],
    progress_at: now,
    regressed: null,
  }
}

/** Notes that `conversation` worked on `feature`, once per session. */
export function touchSession(feature: Feature, conversation: Conversation | null): Feature {
  if (!conversation) return feature
  const last = feature.sessions[feature.sessions.length - 1]
  if (last?.id === conversation.session_id) return feature
  return { ...feature, sessions: [...feature.sessions, { id: conversation.session_id, at: conversation.at }].slice(-SESSIONS_KEPT) }
}

/** A kebab-case id from a title, unique among `taken`. */
export function slugify(title: string, taken: ReadonlySet<string>): string {
  const base =
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .replace(/-+$/, '') || 'idea'
  let id = base
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`
  return id
}

/** Quick capture: a one-line idea into the backlog, logged as added by the person. */
export function captureIdea(roadmap: Roadmap, line: string, now: string): { roadmap: Roadmap; id: string } | { error: string } {
  const title = line.replace(/\s+/g, ' ').trim()
  if (!title) return { error: 'Type an idea first.' }
  if (title.length > TEXT_LIMITS.idea) return { error: `Keep it to ${TEXT_LIMITS.idea} characters.` }
  const id = slugify(title, new Set(roadmap.features.map(feature => feature.id)))
  const feature: Feature = { ...blankFeature(id, title, now), kind: 'logic', ui_state: null, idea: true }
  const change: Change = { at: now, id, title, field: 'added', from: null, to: 'not_started', source: 'you' }
  return {
    roadmap: { ...roadmap, features: [...roadmap.features, feature], last_touched: now, recent_changes: keepChanges([change, ...roadmap.recent_changes], now) },
    id,
  }
}

/** Today's overall progress into the daily log (one entry per day, the latest wins). */
export function recordProgress(roadmap: Roadmap, now: string): Roadmap {
  const day = now.slice(0, 10)
  const overall = progress(roadmap).overall
  const last = roadmap.progress_log[roadmap.progress_log.length - 1]
  if (last?.day === day && last.overall === overall) return roadmap
  const log = [...roadmap.progress_log.filter(entry => entry.day !== day), { day, overall }].slice(-PROGRESS_DAYS)
  return { ...roadmap, progress_log: log }
}

/**
 * Applies one call of the update tool: all of it or none of it. `started`
 * names the features this call put in progress, in order, and `stopped` those
 * it took out of progress, so the caller can follow the active feature.
 */
export function applyUpdate(current: Roadmap, input: UpdateInput, context: UpdateContext): Applied {
  const errors: string[] = []
  const started: string[] = []
  const stopped: string[] = []
  const log: Change[] = []
  let features = current.features.map(feature => ({ ...feature, related_files: [...feature.related_files] }))
  const byId = new Map(features.map(feature => [feature.id, feature]))
  const milestones = input.milestones === undefined ? current.milestones : milestonesOf(input.milestones, errors)
  const record = (feature: Feature, field: ChangeField, from: string | null, to: string | null) =>
    log.push({ at: context.now, id: feature.id, title: feature.title, field, from, to, source: 'claude' })

  for (const [index, raw] of (Array.isArray(input.changes) ? input.changes : []).entries()) {
    const at = `changes[${index}]`
    if (!isObject(raw) || typeof raw.id !== 'string') {
      errors.push(`${at}: needs an id`)
      continue
    }
    const change = raw as FeatureChange
    let feature = byId.get(change.id)
    const isNew = feature === undefined
    if (feature === undefined) {
      const title = text(change.title)
      if (!title) {
        const known = [...byId.keys()].slice(0, 40).join(', ')
        errors.push(`${at}: no feature "${change.id}". Give a title to add it, or use one of: ${known}`)
        continue
      }
      feature = blankFeature(change.id, title, context.now)
      features.push(feature)
      byId.set(feature.id, feature)
    }
    const where = `${at} (${feature.id})`
    const was = { status: feature.status, ui: feature.ui_state, functional: feature.functional_state }

    if (change.title !== undefined) feature.title = text(change.title) ?? feature.title
    if (change.description !== undefined) feature.description = String(change.description).trim()
    if (change.kind !== undefined) feature.kind = oneOf(change.kind, KINDS, `${where}: kind`, errors) ?? feature.kind
    if (change.milestone !== undefined) feature.milestone = change.milestone === null ? null : text(change.milestone)
    if (change.status !== undefined) {
      feature.status = oneOf(change.status, STATUSES, `${where}: status`, errors) ?? feature.status
      // Claude's own call on the status replaces whatever detection had decided.
      feature.auto_blocked = null
    }
    // A logic feature has no UI state at all; one that becomes ui starts at none.
    if (feature.kind === 'logic') {
      if (change.ui_state !== undefined && change.ui_state !== null && change.ui_state !== 'none') {
        errors.push(`${where}: ${LOGIC_HAS_NO_UI}`)
      }
      feature.ui_state = null
    } else {
      if (change.ui_state !== undefined && change.ui_state !== null) {
        feature.ui_state = oneOf(change.ui_state, UI_STATES, `${where}: ui_state`, errors) ?? feature.ui_state
      }
      feature.ui_state ??= 'none'
    }
    // Done never implies working: working is claimed only with how it was confirmed.
    if (change.functional_state !== undefined) {
      feature.functional_state =
        oneOf(change.functional_state, FUNCTIONAL_STATES, `${where}: functional_state`, errors) ??
        feature.functional_state
    }
    if (change.verified_by !== undefined) {
      feature.verified_by = oneOf(change.verified_by, VERIFICATIONS, `${where}: verified_by`, errors) ?? feature.verified_by
    }
    if (feature.functional_state !== 'working') feature.verified_by = null
    else if (was.functional !== 'working' && change.verified_by === undefined) errors.push(`${where}: ${WORKING_NEEDS}`)
    const terse = (label: string, value: unknown, limit: number) => {
      const said = text(value)
      if (said !== null && said.length > limit) errors.push(`${where}: ${label} is ${said.length} characters; keep it to ${limit}: a headline and facts`)
      return said
    }
    if (change.blocker_reason !== undefined) feature.blocker_reason = terse('blocker_reason', change.blocker_reason, TEXT_LIMITS.reason)
    if (change.blocked_on !== undefined) feature.blocked_on = oneOf(change.blocked_on, BLOCKERS, `${where}: blocked_on`, errors)
    if (feature.status !== 'blocked') {
      feature.blocker_reason = null
      feature.blocked_on = null
      feature.auto_blocked = null
    } else {
      if (!feature.blocker_reason) errors.push(`${where}: blocked needs a blocker_reason (what it waits on)`)
      feature.blocked_on ??= inferBlockedOn(feature.blocker_reason)
    }
    if (change.parked_reason !== undefined) feature.parked_reason = terse('parked_reason', change.parked_reason, TEXT_LIMITS.reason)
    if (feature.status !== 'parked') feature.parked_reason = null
    else if (!feature.parked_reason) errors.push(`${where}: parked needs a parked_reason (why it was set aside)`)
    if (change.note !== undefined) {
      const note = String(change.note).trim()
      if (note.length > TEXT_LIMITS.note || note.split('\n').length > TEXT_LIMITS.note_lines) {
        errors.push(`${where}: note must be at most ${TEXT_LIMITS.note_lines} short lines (${TEXT_LIMITS.note} characters): facts, no prose`)
      } else feature.note = note
    }
    if (change.depends_on !== undefined) {
      if (!Array.isArray(change.depends_on) || !change.depends_on.every(id => typeof id === 'string')) {
        errors.push(`${where}: depends_on must be a list of feature ids`)
      } else feature.depends_on = [...new Set(change.depends_on)].filter(id => id !== feature?.id)
    }
    if (change.pinned !== undefined) feature.pinned = change.pinned === true

    if (change.needs_config !== undefined) {
      if (!Array.isArray(change.needs_config) || !change.needs_config.every(name => typeof name === 'string' && /^[A-Z][A-Z0-9_]*$/.test(name))) {
        errors.push(`${where}: needs_config must be a list of env var names (UPPER_SNAKE)`)
      } else feature.needs_config = [...new Set(change.needs_config)]
    }
    if (change.add_files !== undefined) {
      if (!Array.isArray(change.add_files)) errors.push(`${where}: add_files must be a list of paths`)
      else {
        const added = change.add_files.filter((file): file is string => typeof file === 'string' && file !== '')
        const kept = feature.related_files.filter(file => !added.includes(file))
        feature.related_files = [...kept, ...added].slice(-RELATED_FILES_KEPT)
      }
    }

    // Planning an idea (a status past not started, or a milestone) makes it ordinary work.
    if (feature.idea && (feature.status !== 'not_started' || feature.milestone !== null)) feature.idea = false
    if (feature.functional_state === 'working') feature.regressed = null
    const moved = isNew || feature.status !== was.status || feature.ui_state !== was.ui || feature.functional_state !== was.functional
    if (moved) feature.progress_at = context.now

    if (isNew) record(feature, 'added', null, feature.status)
    else {
      if (feature.status !== was.status) record(feature, 'status', was.status, feature.status)
      if (feature.ui_state !== null && was.ui !== null && feature.ui_state !== was.ui) {
        record(feature, 'ui_state', was.ui, feature.ui_state)
      }
      if (feature.functional_state !== was.functional) {
        record(feature, 'functional_state', was.functional, feature.functional_state)
      }
    }
    if (feature.status !== was.status || isNew) {
      if (feature.status === 'in_progress') started.push(feature.id)
      if (was.status === 'in_progress' && !isNew) stopped.push(feature.id)
    }
    feature.updated_at = context.now
    if (context.conversation) feature.last_conversation = context.conversation
    const touched = touchSession(feature, context.conversation)
    feature.sessions = touched.sessions
  }

  if (input.remove !== undefined) {
    const ids = Array.isArray(input.remove) ? input.remove : []
    for (const id of ids) {
      const feature = byId.get(id)
      if (!feature) errors.push(`remove: no feature "${String(id)}"`)
      else {
        record(feature, 'removed', feature.status, null)
        if (feature.status === 'in_progress') stopped.push(id)
      }
    }
    features = features.filter(feature => !ids.includes(feature.id))
  }

  if (input.queue !== undefined) {
    if (!Array.isArray(input.queue)) errors.push('queue must be a list of ids')
    else {
      for (const id of input.queue) {
        const feature = byId.get(id)
        if (!feature) errors.push(`queue: no feature "${String(id)}"`)
        else if (feature.status !== 'queued') errors.push(`queue: "${id}" is ${feature.status}, not queued`)
      }
      features = reorderQueue(features, input.queue)
    }
  }

  // A milestone that went away takes its features' membership with it.
  for (const feature of features) {
    if (feature.milestone !== null && !milestones.some(milestone => milestone.id === feature.milestone)) {
      if (input.milestones !== undefined) feature.milestone = null
    }
  }

  const decisions: Decision[] = []
  if (input.decisions !== undefined) {
    if (!Array.isArray(input.decisions)) errors.push('decisions must be a list of { text, feature? }')
    else {
      for (const [index, raw] of input.decisions.entries()) {
        const said = isObject(raw) ? text(raw.text) : null
        const feature = isObject(raw) ? text(raw.feature) : null
        if (!said) errors.push(`decisions[${index}]: needs text`)
        else if (said.length > TEXT_LIMITS.decision) {
          errors.push(`decisions[${index}]: ${said.length} characters; keep it to ${TEXT_LIMITS.decision}: "X, because Y"`)
        } else if (feature !== null && !byId.has(feature)) errors.push(`decisions[${index}]: no feature "${feature}"`)
        else decisions.push({ at: context.now, text: said, feature })
      }
    }
  }

  let ignored = current.ignored_files
  if (input.ignore_files !== undefined) {
    if (!Array.isArray(input.ignore_files) || !input.ignore_files.every(path => typeof path === 'string')) errors.push('ignore_files must be a list of paths')
    else ignored = [...new Set([...input.ignore_files.filter(path => path !== ''), ...current.ignored_files])].slice(0, IGNORED_FILES_KEPT)
  }

  const leftOff = input.where_i_left_off === undefined ? null : text(input.where_i_left_off)
  if (leftOff !== null && leftOff.length > TEXT_LIMITS.where_i_left_off) {
    errors.push(`where_i_left_off is ${leftOff.length} characters; keep it to ${TEXT_LIMITS.where_i_left_off}: what's done, what's next`)
  }

  if (errors.length > 0) return { roadmap: null, errors, started, stopped }

  const next: Roadmap = {
    ...current,
    milestones,
    features,
    last_touched: context.now,
    where_i_left_off: leftOff ?? current.where_i_left_off,
    left_off_at: leftOff ? context.now : current.left_off_at,
    synced_at: input.synced === true ? context.now : current.synced_at,
    synced_commit: input.synced === true ? (context.head ?? current.synced_commit) : current.synced_commit,
    recent_changes: keepChanges([...log.reverse(), ...current.recent_changes], context.now),
    decisions: [...decisions.reverse(), ...current.decisions].slice(0, DECISIONS_KEPT),
    ignored_files: ignored,
  }
  const checked = validate(next, context.now)

  return checked.roadmap
    ? { roadmap: checked.roadmap, errors: [], started, stopped }
    : { roadmap: null, errors: checked.errors, started, stopped }
}

/** The per-feature states the mod last saw, to tell a change made outside it. */
export type Snapshot = Record<
  string,
  { title: string; status: Status; ui_state: UiState | null; functional_state: FunctionalState }
>

export function snapshotOf(roadmap: Roadmap): Snapshot {
  return Object.fromEntries(
    roadmap.features.map(feature => [
      feature.id,
      {
        title: feature.title,
        status: feature.status,
        ui_state: feature.ui_state,
        functional_state: feature.functional_state,
      },
    ]),
  )
}

/** The changes between what the mod last wrote and the file as it stands now. */
export function diffOutside(before: Snapshot, after: Roadmap, now: string): Change[] {
  const changes: Change[] = []
  const add = (id: string, title: string, field: ChangeField, from: string | null, to: string | null) =>
    changes.push({ at: now, id, title, field, from, to, source: 'outside' })

  for (const feature of after.features) {
    const was = before[feature.id]
    if (!was) {
      add(feature.id, feature.title, 'added', null, feature.status)
      continue
    }
    if (was.status !== feature.status) add(feature.id, feature.title, 'status', was.status, feature.status)
    if (was.ui_state !== feature.ui_state && was.ui_state !== null && feature.ui_state !== null) {
      add(feature.id, feature.title, 'ui_state', was.ui_state, feature.ui_state)
    }
    if (was.functional_state !== feature.functional_state) {
      add(feature.id, feature.title, 'functional_state', was.functional_state, feature.functional_state)
    }
  }
  const ids = new Set(after.features.map(feature => feature.id))
  for (const [id, was] of Object.entries(before)) {
    if (!ids.has(id)) add(id, was.title, 'removed', was.status, null)
  }

  return changes
}

/** "12m ago", "3h ago", "2d ago" from two instants. */
export function ago(iso: string | null, nowMs: number): string {
  if (!iso) return 'never'
  const minutes = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60_000))
  if (Number.isNaN(minutes)) return 'unknown'
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`
  return `${Math.round(minutes / (60 * 24))}d ago`
}

const pct = (value: number | null) => (value === null ? 'n/a' : `${value}%`)

/** One short line for the model beside a prompt: only sent again when it changes. */
export function contextLine(roadmap: Roadmap, active: string | null): string {
  const p = progress(roadmap)
  const list = (status: Status, limit: number) =>
    roadmap.features.filter(feature => feature.status === status).slice(0, limit)
  const parked = list('parked', 5).map(feature => feature.id)
  const blocked = list('blocked', 5).map(feature => `${feature.id} (${feature.blocked_on === 'you' ? 'needs the user: ' : ''}${feature.blocker_reason ?? ''})`)
  const next = nextUp(roadmap)
  const broke = roadmap.features.filter(feature => feature.regressed !== null).slice(0, 5)
  const parts = [
    `noWhat (.claude/nowhat.json): ${pct(p.overall)} overall, UI ${pct(p.ui)}, functional ${pct(p.functional)}.`,
    ...(broke.length > 0 ? [`Broke (was working): ${broke.map(feature => `${feature.id} (${feature.regressed?.reason})`).join(', ')}.`] : []),
    `Active feature (your file edits are filed under it): ${active ?? 'none'}.`,
    `In progress: ${list('in_progress', 8).map(feature => feature.id).join(', ') || 'none'}.`,
    `Blocked: ${blocked.join(', ') || 'none'}.`,
    ...(parked.length > 0 ? [`Parked: ${parked.join(', ')}.`] : []),
    `Next up: ${next ? next.id : 'none'}.`,
  ]

  return parts.join(' ')
}

const stateLabel = (feature: Feature) =>
  feature.kind === 'ui' ? `UI ${feature.ui_state} · works ${feature.functional_state}` : `works ${feature.functional_state}`

/** The plain-text view `/nowhat` prints where nothing can draw the sidebar. */
export function summaryText(roadmap: Roadmap, nowMs: number): string {
  const p = progress(roadmap)
  const flag = (feature: Feature) =>
    p.unverified.includes(feature.id)
      ? '  ⚑ unverified'
      : p.designedNotWorking.includes(feature.id)
        ? '  ⚑ designed, not working'
        : p.workingNotPolished.includes(feature.id)
          ? '  ⚑ working, not polished'
          : ''
  const section = (label: string, features: Feature[], detail: (feature: Feature) => string) =>
    features.length === 0 ? [] : [`${label} (${features.length})`, ...features.map(feature => `  ${detail(feature)}`)]
  const of = (status: Status) => roadmap.features.filter(feature => feature.status === status)
  const blocked = of('blocked')
  const next = nextUp(roadmap)

  const lines = [
    `${roadmap.name}: ${pct(p.overall)} (UI ${pct(p.ui)} · functional ${pct(p.functional)}) · last touched ${ago(roadmap.last_touched, nowMs)}`,
    next ? `Next up: ${next.title}` : '',
    `Where you left off: ${roadmap.where_i_left_off || '(not written yet)'}`,
    ...section('Needs you', blocked.filter(feature => feature.blocked_on === 'you'), feature => `${feature.title} · ${feature.blocker_reason}`),
    ...section('Needs code', blocked.filter(feature => feature.blocked_on !== 'you'), feature => `${feature.title} · ${feature.blocker_reason}`),
    ...section('In progress', of('in_progress'), feature => `${feature.title} · ${stateLabel(feature)}${flag(feature)}`),
    ...section('Queue', of('queued'), feature => feature.title),
    ...section('Not started', of('not_started'), feature => feature.title),
    ...section('Parked', of('parked'), feature => `${feature.title} · ${feature.parked_reason}`),
    ...section('Done', of('done'), feature => `${feature.title}${flag(feature)}`),
  ]

  return lines.filter(line => line !== '').join('\n')
}
