// noWhat: keeps .claude/nowhat.json current from evidence, gives Claude a cheap
// way to record what it does, and draws the sidebar. One command, /nowhat: set
// up a project that has no features file yet, else show or hide the sidebar.
//
// Everything that reaches disk, git, a host CLI or the network lives in this
// file, because `$` never crosses an import. The decisions live in pure modules:
// detect.ts (what the repository says), reconcile.ts (evidence → states),
// schema.ts (the file format) and view.tsx (the dashboard).

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  ENV_MODULE,
  type EnvPresence,
  type EnvRead,
  type HostKind,
  type Inventory,
  LOG_FORMAT,
  MANIFEST_NAMES,
  MARKER_PATTERN,
  type Manifest,
  type TestCommand,
  declaredNames,
  envNamesFrom,
  envReads,
  featureEvidence,
  inventoryOf,
  isSourceFile,
  isTestCommand,
  isTestFile,
  optionalInSchema,
  parseGitActivity,
  parseGitCommits,
  parseGrepCounts,
  importNames,
  importPatterns,
  parseGrepMatches,
  parseImportMatches,
  sourceNameCounts,
  unsortedFiles,
  parseStatus,
  parseTestRun,
  referenceNames,
} from './detect'
import { DATA_FILE, EVIDENCE_FILE, type Place, messageOf, placeFrom, projectPath, serial, titleFrom } from './project'
import { LAUNCH_PATTERNS, type LaunchCheck, type LaunchKind, type LaunchPattern, deviceBuildOf, launchChecks, launchKind, privacyUrlOf } from './launch'
import { type ProjectSummary, sortProjects, summarize } from './portfolio'
import { type Evidence, initialStatus, reconcile, signalsOf } from './reconcile'
import {
  BLOCKERS,
  type Change,
  type Conversation,
  type Feature,
  FUNCTIONAL_STATES,
  KINDS,
  type Roadmap,
  STATUSES,
  type Snapshot,
  UI_STATES,
  type UpdateInput,
  VERIFICATIONS,
  ago,
  applyUpdate,
  captureIdea,
  contextLine,
  diffOutside,
  keepChanges,
  nextUp,
  progress,
  recordProgress,
  reorderQueue,
  serialize,
  snapshotOf,
  summaryText,
  touchSession,
  validate,
} from './schema'
import { OPEN_BY_DEFAULT, TABS, type Tab, renderPane } from './view'

type $ = EngineInterface

const PANE = 'nowhat'
const TITLE = 'noWhat'
/** Host CLIs (and the launch checks that need the network) are asked again after this long, or sooner when something changed. */
const HOST_TTL_MS = 15 * 60 * 1000
/** While the sidebar shows, everything but the tests is re-checked this often. */
const RECHECK_MS = 5 * 60 * 1000
/** New commits (from Codex, a terminal, another session) are looked for this often. */
const HEAD_POLL_MS = 30 * 1000
/** The header's "checked 40s ago" is redrawn this often while the sidebar shows. */
const TICK_MS = 10 * 1000
const TEST_TIMEOUT_MS = 10 * 60 * 1000
const IGNORED_DIRS = /(^|\/)(node_modules|vendor|dist|build|out|\.next|\.expo|Pods|\.venv|venv|__pycache__|target|\.git)\//

// ---------------------------------------------------------------------------
// Session state

const activeFeature = atom({ plugin: 'nowhat', key: 'activeFeature' } as const, null)
const unassignedFiles = atom({ plugin: 'nowhat', key: 'unassignedFiles' } as const, [])
const lastContext = atom({ plugin: 'nowhat', key: 'lastContext' } as const, '')
const sessionTitle = atom({ plugin: 'nowhat', key: 'sessionTitle' } as const, null)
const revision = atom({ plugin: 'nowhat', key: 'revision' } as const, 0)
const openSections = atom({ plugin: 'nowhat', key: 'openSections' } as const, [...OPEN_BY_DEFAULT])
const expandedFeature = atom({ plugin: 'nowhat', key: 'expandedFeature' } as const, null)
const paneView = atom({ plugin: 'nowhat', key: 'paneView' } as const, null)
const expandedProject = atom({ plugin: 'nowhat', key: 'expandedProject' } as const, null)
const previousVisit = atom({ plugin: 'nowhat', key: 'previousVisit' } as const, null)
const visitCommits = atom({ plugin: 'nowhat', key: 'visitCommits' } as const, [])
const visitRecorded = atom({ plugin: 'nowhat', key: 'visitRecorded' } as const, false)
const paneTab = atom({ plugin: 'nowhat', key: 'tab' } as const, 'features')
const checking = atom({ plugin: 'nowhat', key: 'checking' } as const, false)
const captureGeneration = atom({ plugin: 'nowhat', key: 'captureGeneration' } as const, 0)
const setupRequested = atom({ plugin: 'nowhat', key: 'setupRequested' } as const, false)

/** The user's choices in the plugin's settings (userConfig). */
const settings = { runTests: true, checkHosts: true }

/** Set when Claude edits files in a turn, so the turn's end re-reads the evidence. */
let editedThisTurn = false

// ---------------------------------------------------------------------------
// Tool specs

const FEATURE_FIELDS = {
  id: { type: 'string', description: 'kebab-case id' },
  title: { type: 'string' },
  description: { type: 'string', description: 'one line' },
  kind: { enum: KINDS, description: 'ui if it has screens, logic if not' },
  milestone: { type: 'string', description: 'id of one of the project milestones' },
  status: { enum: STATUSES },
  ui_state: { enum: UI_STATES, description: 'ui features only; leave out for logic' },
  functional_state: { enum: FUNCTIONAL_STATES, description: 'working only once confirmed, with verified_by' },
  verified_by: { enum: VERIFICATIONS, description: 'how working was confirmed: ran it, tests pass, or the user said so' },
  blocker_reason: { type: 'string', description: 'required when blocked: what it waits on' },
  blocked_on: { enum: BLOCKERS, description: 'when blocked: you (keys, accounts, a decision) or code' },
  needs_config: {
    type: 'array',
    items: { type: 'string' },
    description: 'env var names it cannot work without, beyond what its own files read; the plugin checks them on the deploy host',
  },
  note: {
    type: 'string',
    description: 'catch-up note: at most 4 terse lines of facts (done, next, last decision). No prose, no filler',
  },
  parked_reason: { type: 'string', description: 'required when status is parked: why, in one short line' },
  depends_on: { type: 'array', items: { type: 'string' }, description: 'ids of features it cannot move on until they are done' },
  pinned: { type: 'boolean', description: 'only when the user asks: detection then never changes this feature' },
}

const MILESTONES_FIELD = {
  type: 'array',
  description: 'phases in order, e.g. [{ id: "v1", title: "Launch v1" }]',
  items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' } }, required: ['id', 'title'] },
}

const UPDATE_SPEC = {
  name: 'update',
  description:
    "Record changes to this project's features (.claude/nowhat.json), which the user watches in the noWhat sidebar: a feature's status, UI or functional state, blocker, milestone, new features, files, the queue's order, decisions and where the user left off. All or nothing: an error saves nothing. An unknown id with a title adds a feature.",
  inputSchema: {
    type: 'object',
    properties: {
      changes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            ...FEATURE_FIELDS,
            add_files: { type: 'array', items: { type: 'string' }, description: 'project-relative paths' },
          },
          required: ['id'],
        },
      },
      where_i_left_off: { type: 'string', description: 'terse, at most 200 characters: "Done: X. Next: Y." No prose' },
      queue: { type: 'array', items: { type: 'string' }, description: 'ids of queued features in the order to do them' },
      remove: { type: 'array', items: { type: 'string' } },
      milestones: MILESTONES_FIELD,
      synced: { type: 'boolean', description: 'true only when finishing a sort (Sort with Claude): the next unsorted list starts from here' },
      ignore_files: {
        type: 'array',
        items: { type: 'string' },
        description: 'project-relative paths of unsorted files that belong to no feature (config, generated, shared helpers): they stop showing as unsorted',
      },
      decisions: {
        type: 'array',
        description: 'key choices just made (a library, an approach, a trade-off), one line each: "X, because Y", at most 160 characters',
        items: { type: 'object', properties: { text: { type: 'string' }, feature: { type: 'string', description: 'feature id, if it is about one' } }, required: ['text'] },
      },
    },
  },
}

const SETUP_SPEC = {
  name: 'setup',
  description:
    "Save this project's features as .claude/nowhat.json, once the user has run /nowhat here. Give each feature the files that implement it (related_files): the plugin reads the evidence for those files (wiring, tests, git activity, config) and sets every state it can prove. Leave status out unless the code can't show it (planned work: not_started or queued). Fails if the file exists, unless replace is true.",
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: "the project's name" },
      where_i_left_off: { type: 'string' },
      milestones: MILESTONES_FIELD,
      features: {
        type: 'array',
        items: {
          type: 'object',
          properties: { ...FEATURE_FIELDS, related_files: { type: 'array', items: { type: 'string' } } },
          required: ['id', 'title', 'related_files'],
        },
      },
      replace: { type: 'boolean' },
    },
    required: ['name', 'features'],
  },
}

const CONTEXT_SPEC = {
  name: 'context',
  description:
    "What a noWhat step starts from, with its instructions, gathered without reading the code for you. setup: the project's inventory (stack, screens, routes, tests, env vars, hosts, docs, hot files, recent commits). sort: the unsorted files, commits since the last sort and each feature's signals. next: the next-up feature with its files and evidence.",
  inputSchema: {
    type: 'object',
    properties: { purpose: { enum: ['setup', 'sort', 'next'] } },
    required: ['purpose'],
  },
  isDeferred: false,
}

const DETECT_SPEC = {
  name: 'detect',
  description:
    "Re-read the evidence for every feature now (wiring, TODO markers, git activity, the deploy host's env var names, and with tests: true the project's test suites) and apply what it proves to .claude/nowhat.json. Returns what changed.",
  inputSchema: {
    type: 'object',
    properties: { tests: { type: 'boolean', description: "also run the project's test suites (slow)" } },
  },
}

// ---------------------------------------------------------------------------
// Disk and git

async function nowIso($: $): Promise<string> {
  return new Date(await $.clock.now()).toISOString()
}

type Ran = { code: number; out: string }

/** Runs a command; null when it can't start (not installed) or times out. */
async function run($: $, argv: readonly string[], cwd: string, timeoutMs = 20_000, env?: Record<string, string>): Promise<Ran | null> {
  try {
    const ran = await $.process.run(argv, env ? { cwd, timeoutMs, env } : { cwd, timeoutMs })
    return { code: ran.exitCode, out: ran.stdout + (ran.stderr ? `\n${ran.stderr}` : '') }
  } catch {
    return null
  }
}

async function git($: $, cwd: string, args: readonly string[], timeoutMs = 15_000): Promise<string | null> {
  try {
    const ran = await $.process.run(['git', ...args], { cwd, timeoutMs })
    return ran.exitCode === 0 ? ran.stdout : null
  } catch {
    return null
  }
}

/** `git grep` answers 1 for "no match": that is an empty result, not a failure. */
async function gitGrep($: $, cwd: string, args: readonly string[]): Promise<string> {
  try {
    const ran = await $.process.run(['git', 'grep', ...args], { cwd, timeoutMs: 30_000 })
    return ran.exitCode <= 1 ? ran.stdout : ''
  } catch {
    return ''
  }
}

const places = new Map<string, Place>()

async function placeOf($: $): Promise<Place> {
  const sessionRoot = await $.session.root()
  const known = places.get(sessionRoot)
  if (known) return known
  const place = placeFrom(
    sessionRoot,
    await git($, sessionRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    await git($, sessionRoot, ['rev-parse', '--show-toplevel']),
  )
  places.set(sessionRoot, place)
  return place
}

async function headOf($: $, root: string): Promise<string | null> {
  return (await git($, root, ['rev-parse', 'HEAD']))?.trim() || null
}

type Seen = { mtimeMs: number; features: Snapshot }

async function remember($: $, path: string, roadmap: Roadmap): Promise<void> {
  const { mtimeMs } = await $.fs.stat(path)
  const seen: Seen = { mtimeMs, features: snapshotOf(roadmap) }
  await $.store.set(`seen:${path}`, seen)
}

/** A random id for a roadmap, so a project keeps its place in the all-projects list when its folder moves. */
function newProjectId(): string {
  const random = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.()
  return random ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

async function saveRoadmap($: $, root: string, roadmap: Roadmap): Promise<void> {
  const path = `${root}/${DATA_FILE}`
  const stamped = recordProgress({ ...roadmap, project_id: roadmap.project_id ?? newProjectId() }, await nowIso($))
  await $.fs.write(path, serialize(stamped))
  await remember($, path, stamped)
  await update($, revision, n => n + 1)
}

type Loaded =
  | { exists: false; roadmap: null; errors: [] }
  | { exists: true; roadmap: Roadmap; errors: [] }
  | { exists: true; roadmap: null; errors: string[] }

/**
 * Reads the roadmap. When the file changed since this mod last wrote it
 * (Codex, a hand edit), its state changes are logged as `outside` and saved.
 */
async function loadRoadmap($: $, root: string): Promise<Loaded> {
  const path = `${root}/${DATA_FILE}`
  if (!(await $.fs.exists(path))) return { exists: false, roadmap: null, errors: [] }

  const now = await nowIso($)
  let parsed: unknown
  try {
    parsed = JSON.parse(String(await $.fs.read(path)))
  } catch (error) {
    return { exists: true, roadmap: null, errors: [`${DATA_FILE} is not valid JSON: ${messageOf(error)}`] }
  }
  const checked = validate(parsed, now)
  if (!checked.roadmap) return { exists: true, roadmap: null, errors: checked.errors }

  let roadmap = checked.roadmap
  const seen = (await $.store.get(`seen:${path}`)) as Seen | undefined
  const { mtimeMs } = await $.fs.stat(path)
  if (seen === undefined) await remember($, path, roadmap)
  else if (seen.mtimeMs !== mtimeMs) {
    const outside = diffOutside(seen.features, roadmap, now)
    if (outside.length > 0) {
      roadmap = { ...roadmap, recent_changes: keepChanges([...outside, ...roadmap.recent_changes], now) }
      await saveRoadmap($, root, roadmap)
    } else await remember($, path, roadmap)
  }

  return { exists: true, roadmap, errors: [] }
}

/** The roadmap as the file holds it, for drawing: reads only, never writes. */
async function readRoadmap($: $, root: string): Promise<Loaded> {
  const path = `${root}/${DATA_FILE}`
  if (!(await $.fs.exists(path))) return { exists: false, roadmap: null, errors: [] }
  try {
    const checked = validate(JSON.parse(String(await $.fs.read(path))), await nowIso($))
    return checked.roadmap
      ? { exists: true, roadmap: checked.roadmap, errors: [] }
      : { exists: true, roadmap: null, errors: checked.errors }
  } catch (error) {
    return { exists: true, roadmap: null, errors: [`${DATA_FILE} is not valid JSON: ${messageOf(error)}`] }
  }
}

type Registry = { version: 1; projects: { path: string; name: string; added_at: string; project_id?: string }[] }

const registryPath = async ($: $) => `${(await $.env.get('HOME')) ?? ''}/.claude/nowhat-projects.json`

/** Every project set up with noWhat, as `~/.claude/nowhat-projects.json` lists them. A broken registry reads as empty. */
let registryCache: { mtimeMs: number; projects: Registry['projects'] } | null = null

async function readRegistry($: $): Promise<Registry['projects']> {
  const path = await registryPath($)
  if (!(await $.fs.exists(path))) return []
  const { mtimeMs } = await $.fs.stat(path)
  if (registryCache && registryCache.mtimeMs === mtimeMs) return registryCache.projects
  try {
    const parsed = JSON.parse(String(await $.fs.read(path))) as Partial<Registry>
    const projects = Array.isArray(parsed.projects)
      ? parsed.projects.filter(project => typeof project?.path === 'string' && typeof project?.name === 'string')
      : []
    registryCache = { mtimeMs, projects }
    return projects
  } catch {
    return []
  }
}

/**
 * Whether the person turned noWhat on in this project by running /nowhat here.
 * Until they do, noWhat reads, checks and writes nothing in it: a features file
 * someone else committed doesn't switch anything on.
 */
async function isOn($: $, root: string): Promise<boolean> {
  return (await readRegistry($)).some(entry => entry.path === root)
}

const OFF = "noWhat is off in this project: the user can run /nowhat here to turn it on."


/**
 * Adds the project to `~/.claude/nowhat-projects.json`, which the all-projects
 * view reads. Called only when the person runs /nowhat in the project: nothing
 * is ever registered or re-mapped by guessing. A project that moved replaces its
 * old entry only on an exact match: the same project id, at a path whose
 * features file is gone. Writes only when something changed.
 */
async function registerProject($: $, root: string, name: string, projectId: string | null, now: string): Promise<void> {
  const path = await registryPath($)
  const projects = await readRegistry($)
  const gone = async (entry: Registry['projects'][number]) => !(await $.fs.exists(`${entry.path}/${DATA_FILE}`))
  const kept: Registry['projects'] = []
  let addedAt: string | null = null
  for (const entry of projects) {
    const same = entry.path === root
    const moved = !same && projectId !== null && entry.project_id === projectId && (await gone(entry))
    if (same || moved) addedAt ??= entry.added_at
    else kept.push(entry)
  }
  const mine = { path: root, name, added_at: addedAt ?? now, ...(projectId ? { project_id: projectId } : {}) }
  const registry: Registry = { version: 1, projects: [...kept, mine] }
  const before = JSON.stringify(projects.map(entry => ({ ...entry })).sort((a, b) => a.path.localeCompare(b.path)))
  const after = JSON.stringify([...registry.projects].sort((a, b) => a.path.localeCompare(b.path)))
  if (before !== after) await $.fs.write(path, `${JSON.stringify(registry, null, 2)}\n`)
}

/** This session as `last_conversation` names it: its id, and its first prompt as a title. */
async function stamp($: $): Promise<{ now: string; conversation: Conversation }> {
  const now = await nowIso($)
  let title = await read($, sessionTitle)
  if (title === null) {
    try {
      title = titleFrom((await $.session.messages()).find(message => message.role === 'user')?.text)
      if (title !== null) await update($, sessionTitle, () => title)
    } catch {
      title = null
    }
  }
  return { now, conversation: { session_id: await $.session.id(), title, at: now } }
}

// The standing rules and each step's instructions ship with the plugin; read once per load.
const prompts = new Map<string, string>()
async function promptText($: $, name: 'rules' | 'setup' | 'sort' | 'next'): Promise<string> {
  const known = prompts.get(name)
  if (known !== undefined) return known
  const text = String(await $.fs.read(`${$.plugin.root}/prompts/${name}.md`)).trim()
  prompts.set(name, text)
  return text
}
const rulesText = ($: $) => promptText($, 'rules')

/** What a button or /nowhat sends: short, visible, and pointing Claude at the instructions. */
const SETUP_PROMPT = 'Set up noWhat for this project: call mcp__nowhat__context with purpose setup and follow its instructions.'
const SORT_PROMPT = "Sort what noWhat doesn't know yet: call mcp__nowhat__context with purpose sort and follow its instructions."
const nextPrompt = (feature: Feature) => `Continue ${feature.title} (${feature.id}): call mcp__nowhat__context with purpose next and follow its instructions.`

const bullets = (items: readonly string[], limit: number) =>
  items.slice(0, limit).map(item => `- ${item}`).join('\n') +
  (items.length > limit ? `\n- …and ${items.length - limit} more` : '')

// ---------------------------------------------------------------------------
// Evidence: gathered here, judged in detect.ts and reconcile.ts

type HostCheck = {
  kind: HostKind
  label: string
  side: 'server' | 'client' | 'both'
  ok: boolean
  names: string[]
  note?: string
}

type LaunchEvidence = {
  kind: LaunchKind
  checks: LaunchCheck[]
  privacy: { url: string; status: number | null; checked_at: string | null } | null
  device_build: 'device' | 'simulator' | 'none' | null
}

type EvidenceFile = {
  version: 2
  checked_at: string
  hosts_checked_at: string | null
  /** What host checks depend on (HEAD, host and env file times): a change re-checks them early. */
  hosts_key?: string | null
  launch?: LaunchEvidence | null
  /** New source files no feature claims, for the sidebar's Unsorted group. */
  unsorted?: string[]
  project: {
    languages: string[]
    frameworks: string[]
    hosts: HostKind[]
    test_commands: TestCommand[]
    tests: string[]
    file_count: number
    screens: number
    routes: number
    git: boolean
  }
  hosts: HostCheck[]
  live: { url: string; ok: boolean; status: number; checked_at: string } | null
  test_runs: { dir: string; command: string; ok: boolean | null; at: string; note?: string }[]
  test_results: Record<string, { ok: boolean; at: string }>
  features: Evidence
}

async function readEvidence($: $, root: string): Promise<EvidenceFile | null> {
  const path = `${root}/${EVIDENCE_FILE}`
  try {
    if (!(await $.fs.exists(path))) return null
    const parsed = JSON.parse(String(await $.fs.read(path))) as EvidenceFile
    // Version 2 added commits and per-file activity; an older file waits for the next detection.
    return parsed.version === 2 ? parsed : null
  } catch {
    return null
  }
}

/** Every file in the project, tracked or not, ignored ones left out. */
async function listFiles($: $, root: string): Promise<{ files: string[]; git: boolean }> {
  const listed = await git($, root, ['ls-files', '--cached', '--others', '--exclude-standard'], 30_000)
  if (listed !== null) {
    const files = [...new Set(listed.split('\n').filter(path => path !== '' && !IGNORED_DIRS.test(path)))]
    return { files, git: true }
  }
  // Not a git repository: walk it, bounded.
  const files: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 6 || files.length >= 5000) return
    let entries: Awaited<ReturnType<typeof $.fs.list>> = []
    try {
      entries = await $.fs.list(dir === '' ? root : `${root}/${dir}`)
    } catch {
      return
    }
    for (const entry of entries) {
      const path = dir === '' ? entry.name : `${dir}/${entry.name}`
      if (entry.name.startsWith('.') && entry.name !== '.vercel') continue
      if (entry.kind === 'dir') {
        if (!IGNORED_DIRS.test(`${path}/`)) await walk(path, depth + 1)
      } else if (entry.kind === 'file') files.push(path)
    }
  }
  await walk('', 0)
  return { files, git: false }
}

async function readManifests($: $, root: string, files: readonly string[]): Promise<Manifest[]> {
  const manifests: Manifest[] = []
  for (const path of files.filter(file => MANIFEST_NAMES.test(file)).slice(0, 40)) {
    try {
      const text = String(await $.fs.read(`${root}/${path}`))
      if (text.length <= 400_000) manifests.push({ path, text })
    } catch {
      // Unreadable: left out.
    }
  }
  return manifests
}

const dirContaining = (files: readonly string[], test: RegExp) => {
  const found = files.find(file => test.test(file))
  return found === undefined ? null : found.includes('/') ? found.slice(0, found.lastIndexOf('/')) : ''
}

const squash = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Asks each detected host which env var names it has. Values are parsed past
 * and dropped: only names are kept, and only names are written to disk.
 */
async function checkHosts(
  $: $,
  root: string,
  files: readonly string[],
  inventory: Inventory,
  manifests: readonly Manifest[],
): Promise<{ checks: HostCheck[]; liveUrl: string | null }> {
  const checks: HostCheck[] = []
  let liveUrl: string | null = null
  const at = (dir: string | null) => (dir === null || dir === '' ? root : `${root}/${dir}`)

  for (const kind of inventory.hosts) {
    if (kind === 'railway') {
      let names: string[] = []
      let label = 'Railway'
      let ok = false
      let note = 'railway CLI not available'
      const take = (out: string) => {
        try {
          const json = JSON.parse(out) as Record<string, unknown>
          names = [...names, ...Object.keys(json)]
          const domain = json.RAILWAY_PUBLIC_DOMAIN
          if (typeof domain === 'string' && domain !== '') liveUrl ??= `https://${domain}`
          return true
        } catch {
          return false
        }
      }
      const linked = await run($, ['railway', 'variables', '--json'], root)
      if (linked && linked.code === 0 && take(linked.out)) ok = true
      else if (linked !== null) {
        // Not linked here: find the project by the repository's own names (its folder, its packages).
        note = 'no Railway project matches this repository'
        const wanted = new Set([root.split('/').pop() ?? '', ...manifests.map(manifest => String(/"name"\s*:\s*"([^"]+)"/.exec(manifest.text)?.[1] ?? ''))].map(squash).filter(Boolean))
        const listed = await run($, ['railway', 'list', '--json'], root)
        try {
          const projects = listed === null ? [] : (JSON.parse(listed.out) as Record<string, unknown>[])
          const project = projects.find(one => wanted.has(squash(String(one.name ?? ''))))
          if (project) {
            const edges = (key: string) =>
              ((project[key] as { edges?: { node?: { name?: string } }[] } | undefined)?.edges ?? [])
                .map(edge => edge.node?.name)
                .filter((name): name is string => typeof name === 'string')
            const environments = edges('environments')
            const environment = environments.includes('production') ? 'production' : (environments[0] ?? 'production')
            const services = edges('services').filter(name => !/postgres|mysql|redis|mongo|database|\bdb\b/i.test(name))
            for (const service of services) {
              const vars = await run($, ['railway', 'variables', '--project', String(project.id), '--service', service, '--environment', environment, '--json'], root)
              if (vars && vars.code === 0 && take(vars.out)) ok = true
            }
            label = `Railway (${environment})`
          }
        } catch {
          // An unparseable listing is unknown, never "missing".
        }
      }
      checks.push({ kind, label, side: 'server', ok, names: [...new Set(names)], ...(ok ? {} : { note }) })
    } else if (kind === 'eas') {
      const ran = await run($, ['eas', 'env:list', '--environment', 'production'], at(dirContaining(files, /(^|\/)eas\.json$/)), 60_000)
      const ok = ran !== null && ran.code === 0 && /Environment:/i.test(ran.out)
      checks.push({
        kind,
        label: 'EAS (production)',
        side: 'client',
        ok,
        names: ok && ran ? envNamesFrom(ran.out, kind) : [],
        ...(ok ? {} : { note: ran === null ? 'eas CLI not available' : 'eas env:list failed' }),
      })
    } else if (kind === 'vercel') {
      const ran = await run($, ['vercel', 'env', 'ls', 'production'], at(dirContaining(files, /(^|\/)(\.vercel\/project\.json|vercel\.json)$/)), 60_000)
      const names = ran && ran.code === 0 ? envNamesFrom(ran.out, kind) : []
      // An empty listing can't be told from an unfamiliar format: only a list with names counts.
      checks.push({ kind, label: 'Vercel (production)', side: 'both', ok: names.length > 0, names, ...(names.length > 0 ? {} : { note: 'vercel CLI not available or project not linked' }) })
    } else if (kind === 'fly') {
      const dir = at(dirContaining(files, /(^|\/)fly\.toml$/))
      const ran = await run($, ['fly', 'secrets', 'list', '--json'], dir, 60_000)
      let names = ran && ran.code === 0 ? envNamesFrom(ran.out, kind) : []
      try {
        const toml = String(await $.fs.read(`${dir}/fly.toml`))
        names = [...names, ...envNamesFrom(/\[env\]([\s\S]*?)(\n\[|$)/.exec(toml)?.[1] ?? '', 'dotenv')]
      } catch {
        // No [env] section.
      }
      const ok = ran !== null && ran.code === 0
      checks.push({ kind, label: 'Fly', side: 'server', ok, names: [...new Set(names)], ...(ok ? {} : { note: 'fly CLI not available or app not found' }) })
    } else if (kind === 'netlify') {
      const ran = await run($, ['netlify', 'env:list', '--json'], root, 60_000)
      const ok = ran !== null && ran.code === 0 && ran.out.trim().startsWith('{')
      checks.push({ kind, label: 'Netlify', side: 'both', ok, names: ok && ran ? envNamesFrom(ran.out, kind) : [], ...(ok ? {} : { note: 'netlify CLI not available or site not linked' }) })
    }
  }

  // Local .env files: the source of last resort, used only for a side no host covers.
  const envNames: string[] = []
  for (const name of ['.env', '.env.local', '.env.production']) {
    try {
      if (await $.fs.exists(`${root}/${name}`)) envNames.push(...envNamesFrom(String(await $.fs.read(`${root}/${name}`)), 'dotenv'))
    } catch {
      // Unreadable: skipped.
    }
  }
  if (envNames.length > 0) checks.push({ kind: 'dotenv', label: 'local .env', side: 'both', ok: true, names: [...new Set(envNames)] })

  return { checks, liveUrl }
}

function presenceOf(checks: readonly HostCheck[]): EnvPresence {
  const pick = (side: 'server' | 'client') => {
    const host =
      checks.find(check => check.ok && check.kind !== 'dotenv' && (check.side === side || check.side === 'both')) ??
      checks.find(check => check.ok && check.kind === 'dotenv')
    return host ? { source: host.label, names: new Set(host.names) } : null
  }
  return { server: pick('server'), client: pick('client') }
}

/** Runs every package's test suite, in parallel, and records each test file's result. */
async function runTests(
  $: $,
  root: string,
  inventory: Inventory,
  previous: EvidenceFile['test_results'],
  now: string,
): Promise<{ runs: EvidenceFile['test_runs']; results: EvidenceFile['test_results'] }> {
  const results = { ...previous }
  const runs = await Promise.all(
    inventory.testCommands.map(async command => {
      const cwd = command.dir === '' ? root : `${root}/${command.dir}`
      const ran = await run($, command.argv, cwd, TEST_TIMEOUT_MS, { CI: '1' })
      const label = command.argv.join(' ')
      if (ran === null) return { dir: command.dir, command: label, ok: null, at: now, note: 'could not run (not installed, or timed out)' }
      const ok = ran.code === 0
      const inDir = inventory.tests.filter(test => command.dir === '' || test.startsWith(`${command.dir}/`))
      const parsed = parseTestRun(ran.out, inDir, ok)
      for (const test of ok ? inDir : parsed.passing) results[test] = { ok: true, at: now }
      for (const test of parsed.failing) results[test] = { ok: false, at: now }
      return { dir: command.dir, command: label, ok, at: now }
    }),
  )
  return { runs, results }
}

type DetectOptions = { hosts: 'cached' | 'refresh' | 'skip'; tests: boolean }

/**
 * Source files added since the last sort (by commit range when it's reachable,
 * else by date) or still untracked, that no feature claims and no sort left out.
 */
async function gatherUnsorted($: $, root: string, roadmap: Roadmap, existing: ReadonlySet<string>): Promise<string[]> {
  const head = await headOf($, root)
  const base = roadmap.synced_commit
  const reachable = base !== null && head !== null && (await git($, root, ['merge-base', '--is-ancestor', base, head])) !== null
  const added = reachable
    ? await git($, root, ['diff', '--name-only', '--diff-filter=A', `${base}..HEAD`])
    : await git($, root, ['log', `--since=${roadmap.synced_at ?? roadmap.last_touched}`, '--no-merges', '--diff-filter=A', '--name-only', '--format='])
  const untracked = await git($, root, ['ls-files', '--others', '--exclude-standard'])
  const claimed = roadmap.features.flatMap(feature => feature.related_files)
  return unsortedFiles([...(added ?? '').split('\n'), ...(untracked ?? '').split('\n')], claimed, roadmap.ignored_files, existing)
}

/** Files a host check reads, or that change what it would find: their times and HEAD make the key. */
const HOST_FILES = /(^|\/)(\.env(\.[a-z]+)?|eas\.json|app\.json|app\.config\.[jt]s|railway\.(json|toml)|vercel\.json|fly\.toml|netlify\.toml)$/

async function hostsKeyOf($: $, root: string, files: readonly string[], isGit: boolean): Promise<string> {
  const head = isGit ? ((await headOf($, root)) ?? '') : ''
  const stamps: string[] = [head]
  for (const file of files.filter(one => HOST_FILES.test(one)).slice(0, 20)) stamps.push(`${file}:${await mtimeOf($, `${root}/${file}`)}`)
  for (const file of ['.env', '.env.local', '.env.production']) stamps.push(`${file}:${await mtimeOf($, `${root}/${file}`)}`)
  return stamps.join('|')
}

/**
 * The launch checklist's evidence: a git grep per pattern every time (cheap),
 * the privacy URL's answer and the EAS build list only when hosts are due.
 */
async function gatherLaunch(
  $: $,
  root: string,
  files: readonly string[],
  inventory: Inventory,
  isGit: boolean,
  previous: LaunchEvidence | null,
  due: boolean,
  liveUrl: string | null,
  now: string,
): Promise<LaunchEvidence | null> {
  const kind = launchKind(inventory.frameworks, files)
  if (kind === null) return null
  const exclude = ['--', '.', ':(exclude)*.md', ':(exclude)*.lock', ':(exclude)**/*.test.*', ':(exclude)**/*.spec.*', ':(exclude)**/__tests__/**']
  let found: Partial<Record<LaunchPattern, string[]>> | null = null
  let privacyUrl: string | null = null
  if (isGit) {
    found = {}
    for (const [pattern, regex] of Object.entries(LAUNCH_PATTERNS) as [LaunchPattern, string][]) {
      found[pattern] = (await gitGrep($, root, ['-l', '-I', '-i', '-E', '-e', regex, ...exclude])).split('\n').filter(Boolean)
    }
    // Docs count here: a policy URL often lives only in a README or a submission checklist.
    const urls = (await gitGrep($, root, ['-h', '-o', '-I', '-E', '-e', 'https?://[A-Za-z0-9.-]+/[A-Za-z0-9./_-]*privacy[A-Za-z0-9./_-]*', '--', '.', ':(exclude)*.lock', ':(exclude)**/*.test.*', ':(exclude)**/__tests__/**'])).split('\n').filter(Boolean)
    privacyUrl = privacyUrlOf(urls)
  }

  // The app config: app.json, or app.config.* read as text.
  const configPath = files.find(file => /(^|\/)app\.json$/.test(file) && !/node_modules/.test(file)) ?? files.find(file => /(^|\/)app\.config\.[jt]s$/.test(file))
  let appConfig: string | null = null
  if (configPath) {
    try {
      appConfig = String(await $.fs.read(`${root}/${configPath}`)).slice(0, 200_000)
    } catch {
      appConfig = null
    }
  }

  let privacy = previous?.privacy && previous.privacy.url === privacyUrl ? previous.privacy : privacyUrl ? { url: privacyUrl, status: null, checked_at: null } : null
  if (privacy && (due || privacy.checked_at === null)) {
    try {
      const response = await $.http.fetch(privacy.url)
      privacy = { url: privacy.url, status: response.status, checked_at: now }
    } catch {
      privacy = { url: privacy.url, status: 0, checked_at: now }
    }
  }

  let deviceBuild = previous?.device_build ?? null
  const easDir = files.find(file => /(^|\/)eas\.json$/.test(file))
  if (kind === 'app' && easDir !== undefined && (due || previous === null)) {
    const dir = easDir.includes('/') ? `${root}/${easDir.slice(0, easDir.lastIndexOf('/'))}` : root
    const ran = await run($, ['eas', 'build:list', '--json', '--non-interactive', '--limit', '20'], dir, 60_000)
    deviceBuild = ran && ran.code === 0 ? deviceBuildOf(ran.out.slice(ran.out.indexOf('['))) : (previous?.device_build ?? null)
  }

  const checks = launchChecks({
    kind,
    found,
    files,
    appConfig,
    privacy: { url: privacy?.url ?? null, status: privacy?.status ?? null },
    deviceBuild,
    liveUrl,
  })
  return { kind, checks, privacy, device_build: deviceBuild }
}

/**
 * Gathers the evidence for every feature of `roadmap` (or the draft setup is
 * about to save), writes .claude/nowhat/evidence.json, and returns it.
 */
async function gatherEvidence($: $, place: Place, roadmap: Roadmap, options: DetectOptions): Promise<EvidenceFile> {
  const root = place.root
  const now = await nowIso($)
  const nowMs = Date.parse(now)
  const previous = await readEvidence($, root)
  const { files, git: isGit } = await listFiles($, root)
  const manifests = await readManifests($, root, files)
  const inventory = inventoryOf(files, manifests)
  const fileSet = new Set(files)

  const related = [...new Set(roadmap.features.flatMap(feature => feature.related_files))]
  const existing = related.filter(path => fileSet.has(path))
  const sources = existing.filter(path => isSourceFile(path) && !isTestFile(path))

  let references: Map<string, Set<string>> | null = null
  let testImports: Map<string, Set<string>> | null = null
  let markers = new Map<string, number>()
  let activity = new Map<string, { last: string; recent: number }>()
  let commits = new Map<string, { hash: string; at: string; subject: string }[]>()
  let uncommitted = new Set<string>()
  if (isGit) {
    const names = [...new Set(sources.flatMap(referenceNames))].slice(0, 400)
    references =
      names.length === 0
        ? new Map()
        : parseGrepMatches(await gitGrep($, root, ['-I', '-o', '-w', '-F', ...names.flatMap(name => ['-e', name]), '--', '.', ':(exclude)*.md', ':(exclude)*.lock']))
    // Which tests import each feature file by path: one more grep, over the test files only.
    const testFiles = files.filter(path => isTestFile(path) && isSourceFile(path))
    const counts = sourceNameCounts(files)
    const imported = [...new Set(sources.flatMap(path => importNames(path, counts)))].slice(0, 400)
    testImports =
      imported.length === 0 || testFiles.length === 0 || testFiles.length > 3000
        ? new Map()
        : parseImportMatches(
            await gitGrep($, root, ['-I', '-o', '-F', ...imported.flatMap(name => importPatterns(name).flatMap(pattern => ['-e', pattern])), '--', ...testFiles]),
            imported,
          )
    markers = existing.length === 0 ? new Map() : parseGrepCounts(await gitGrep($, root, ['-I', '-c', '-E', '-e', MARKER_PATTERN, '--', ...existing]))
    const log = (await git($, root, ['log', '--since=90.days.ago', '--no-merges', '--name-only', LOG_FORMAT], 30_000)) ?? ''
    activity = parseGitActivity(log, nowMs)
    commits = parseGitCommits(log)
    uncommitted = parseStatus((await git($, root, ['status', '--porcelain', '--untracked-files=all'])) ?? '')
  }

  // Env reads per source file; names an env schema declares optional count as optional.
  const schemaOptional = new Set<string>()
  for (const path of files.filter(file => ENV_MODULE.test(file)).slice(0, 6)) {
    try {
      for (const name of optionalInSchema(String(await $.fs.read(`${root}/${path}`)))) schemaOptional.add(name)
    } catch {
      // Unreadable: no optional names from it.
    }
  }
  const reads = new Map<string, EnvRead[]>()
  for (const path of sources.slice(0, 200)) {
    try {
      const found = envReads(String(await $.fs.read(`${root}/${path}`)))
      reads.set(path, found.map(one => (schemaOptional.has(one.name) ? { ...one, optional: true } : one)))
    } catch {
      // Unreadable: no env reads from it.
    }
  }

  // Hosts: asked on a refresh, after HOST_TTL_MS, or when HEAD or a host or env file changed; otherwise the last answer stands.
  let hosts = previous?.hosts ?? []
  let hostsCheckedAt = previous?.hosts_checked_at ?? null
  let live = previous?.live ?? null
  const hostsKey = await hostsKeyOf($, root, files, isGit)
  const isStale = hostsCheckedAt === null || nowMs - Date.parse(hostsCheckedAt) > HOST_TTL_MS || hostsKey !== (previous?.hosts_key ?? null)
  const hostsDue = settings.checkHosts && (options.hosts === 'refresh' || (options.hosts === 'cached' && isStale))
  if (hostsDue) {
    const checked = await checkHosts($, root, files, inventory, manifests)
    hosts = checked.checks
    hostsCheckedAt = now
    if (checked.liveUrl) {
      const hasHealth = (await gitGrep($, root, ['-I', '-l', '-F', '-e', "'/health'", '-e', '"/health"', '--', '.'])).trim() !== ''
      const url = `${checked.liveUrl}${hasHealth ? '/health' : ''}`
      try {
        const response = await $.http.fetch(url)
        live = { url, ok: response.status < 500, status: response.status, checked_at: now }
      } catch {
        live = { url, ok: false, status: 0, checked_at: now }
      }
    }
  }
  if (!settings.checkHosts) hosts = []
  const launch = await gatherLaunch($, root, files, inventory, isGit, previous?.launch ?? null, hostsDue, live?.url ?? null, now)
  const unsorted = isGit ? await gatherUnsorted($, root, roadmap, fileSet) : []

  let testRuns = previous?.test_runs ?? []
  let testResults = previous?.test_results ?? {}
  if (options.tests && settings.runTests && inventory.testCommands.length > 0) {
    const ran = await runTests($, root, inventory, testResults, now)
    testRuns = ran.runs
    testResults = ran.results
  }

  const facts = {
    frameworks: inventory.frameworks,
    files: fileSet,
    references,
    testImports,
    markers,
    activity,
    commits,
    uncommitted,
    envReads: reads,
    env: presenceOf(hosts),
    testResults,
  }
  const features: Evidence = {}
  for (const feature of roadmap.features) {
    if (feature.related_files.length > 0) features[feature.id] = featureEvidence(feature.related_files, facts, feature.needs_config)
  }

  const evidence: EvidenceFile = {
    version: 2,
    checked_at: now,
    hosts_checked_at: hostsCheckedAt,
    hosts_key: hostsDue ? hostsKey : (previous?.hosts_key ?? null),
    launch,
    unsorted,
    project: {
      languages: inventory.languages,
      frameworks: inventory.frameworks,
      hosts: inventory.hosts,
      test_commands: inventory.testCommands,
      tests: inventory.tests,
      file_count: inventory.fileCount,
      screens: inventory.screens.length,
      routes: inventory.routes.length,
      git: isGit,
    },
    hosts,
    live,
    test_runs: testRuns,
    test_results: testResults,
    features,
  }
  await $.fs.write(`${root}/${EVIDENCE_FILE}`, `${JSON.stringify(evidence, null, 2)}\n`)
  return evidence
}

/** When the last detection finished (wall clock), so opening the sidebar doesn't re-check what was just checked. */
let lastDetectAt = 0

// One detection at a time; requests while one runs fold into a single follow-up.
let detecting: Promise<string> | null = null
let detectAgain: DetectOptions | null = null

/** Re-reads the evidence and applies it to the roadmap; returns a short account of what changed. */
function detect($: $, options: DetectOptions): Promise<string> {
  if (detecting) {
    detectAgain = {
      hosts: detectAgain?.hosts === 'refresh' || options.hosts === 'refresh' ? 'refresh' : options.hosts,
      tests: (detectAgain?.tests ?? false) || options.tests,
    }
    return detecting
  }
  detecting = (async () => {
    await update($, checking, () => true)
    try {
      const place = await placeOf($)
      if (!(await isOn($, place.root))) return OFF
      const loaded = await readRoadmap($, place.root)
      if (!loaded.roadmap) return 'Nothing set up to check yet.'
      const evidence = await gatherEvidence($, place, loaded.roadmap, options)
      const changes = await serial(async () => {
        const fresh = await loadRoadmap($, place.root)
        if (!fresh.roadmap) return []
        const reconciled = reconcile(fresh.roadmap, evidence.features, await nowIso($))
        if (reconciled.changes.length > 0) await saveRoadmap($, place.root, reconciled.roadmap)
        else await update($, revision, n => n + 1)
        return reconciled.changes
      })
      return describeDetection(evidence, changes)
    } finally {
      lastDetectAt = Date.now()
      await update($, checking, () => false)
      detecting = null
      const again = detectAgain
      detectAgain = null
      if (again) void detect($, again)
    }
  })()
  return detecting
}

function describeDetection(evidence: EvidenceFile, changes: readonly Change[]): string {
  const hosts = evidence.hosts.map(host => `${host.label} ${host.ok ? `(${host.names.length} names)` : `(not checked: ${host.note ?? 'failed'})`}`)
  const runs = evidence.test_runs.map(one => `${one.command} in ${one.dir || '.'}: ${one.ok === null ? one.note : one.ok ? 'passed' : 'failed'}`)
  const lines = changes.map(change =>
    change.field === 'status'
      ? `${change.title}: ${change.from} → ${change.to}`
      : `${change.title}: ${change.field.replace('_state', '')} ${change.from} → ${change.to}`,
  )
  return [
    `Checked ${Object.keys(evidence.features).length} features.`,
    hosts.length > 0 ? `Config: ${hosts.join('; ')}.` : 'Config: no deploy host found to check.',
    runs.length > 0 ? `Tests: ${runs.join('; ')}.` : '',
    evidence.live ? `Live: ${evidence.live.url} answered ${evidence.live.status || 'nothing'}.` : '',
    evidence.launch
      ? `Launch: ${evidence.launch.checks.filter(check => check.state === 'ok').length}/${evidence.launch.checks.length} checks pass${evidence.launch.checks.some(check => check.state === 'fail') ? `; failing: ${evidence.launch.checks.filter(check => check.state === 'fail').map(check => check.label).join(', ')}` : ''}.`
      : '',
    lines.length > 0 ? `Detected:\n${bullets(lines, 30)}` : 'Nothing changed.',
  ]
    .filter(Boolean)
    .join('\n')
}

// ---------------------------------------------------------------------------
// What the skills start from

/** Setup: the project's inventory, with no code read for Claude. */
async function setupFacts($: $, place: Place): Promise<string> {
  const root = place.root
  const { files, git: isGit } = await listFiles($, root)
  const inventory = inventoryOf(files, await readManifests($, root, files))
  const nowMs = await $.clock.now()

  const dirs = new Map<string, number>()
  for (const file of files) {
    const parts = file.split('/')
    if (parts.length < 2) continue
    const top = parts.slice(0, parts.length > 2 ? 2 : 1).join('/')
    dirs.set(top, (dirs.get(top) ?? 0) + 1)
  }
  const envNames = new Set<string>()
  // Names declared in env schemas and .env examples, then names read straight from the environment.
  for (const path of files.filter(file => ENV_MODULE.test(file) || /(^|\/)\.env\.(example|sample|template)$/.test(file)).slice(0, 8)) {
    try {
      for (const name of declaredNames(String(await $.fs.read(`${root}/${path}`)))) envNames.add(name)
    } catch {
      // Unreadable: skipped.
    }
  }
  const envLines = await gitGrep($, root, ['-I', '-h', '-o', '-E', '-e', '(env|ENV|environ|getenv|Getenv|env::var|System\\.getenv)[^A-Za-z0-9_]{0,4}[A-Z][A-Z0-9_]{2,}', '--', '.', ':(exclude)*.md'])
  for (const line of envLines.split('\n')) {
    const name = /([A-Z][A-Z0-9_]{2,})$/.exec(line)?.[1]
    if (name) envNames.add(name)
  }
  const activity = isGit
    ? parseGitActivity((await git($, root, ['log', '--since=60.days.ago', '--no-merges', '--name-only', '--format=@@%cI'], 30_000)) ?? '', nowMs)
    : new Map<string, { last: string; recent: number }>()
  const hot = [...activity].filter(([path]) => !isTestFile(path) && isSourceFile(path)).sort((a, b) => b[1].recent - a[1].recent).slice(0, 25)
  const commits = isGit ? ((await git($, root, ['log', '-30', '--no-merges', '--date=short', '--format=%ad %s'])) ?? '').trim().split('\n').filter(Boolean) : []
  const tags = isGit ? ((await git($, root, ['tag', '--sort=-creatordate'])) ?? '').trim().split('\n').filter(Boolean).slice(0, 8) : []
  let milestones: string[] = []
  const remote = isGit ? ((await git($, root, ['remote', 'get-url', 'origin'])) ?? '') : ''
  const slug = /github\.com[:/]([^/]+\/[^/.\s]+)/.exec(remote)?.[1]
  if (slug) {
    const ran = await run($, ['gh', 'api', `repos/${slug}/milestones?state=all`, '--jq', '.[].title'], root)
    if (ran?.code === 0) milestones = ran.out.trim().split('\n').filter(Boolean).slice(0, 12)
  }

  return [
    `Project: ${root.split('/').pop() ?? root}, at ${root}. ${inventory.fileCount} files${isGit ? '' : ' (not a git repository: wiring and history are unknown)'}.`,
    `Stack: ${[...inventory.languages, ...inventory.frameworks].join(', ') || 'unknown'}.`,
    `Hosts: ${inventory.hosts.join(', ') || 'none detected'}. Test commands: ${inventory.testCommands.map(command => `${command.argv.join(' ')} (in ${command.dir || '.'})`).join('; ') || 'none'}.`,
    `Folders (files): ${[...dirs].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([dir, count]) => `${dir} ${count}`).join(', ')}.`,
    `Screens (${inventory.screens.length}):\n${bullets(inventory.screens, 80)}`,
    `Server routes (${inventory.routes.length}):\n${bullets(inventory.routes, 60)}`,
    `Tests: ${inventory.tests.length} files.`,
    `Env vars the code reads: ${[...envNames].sort().slice(0, 80).join(', ') || 'none'}.`,
    `Planning docs: ${inventory.docs.join(', ') || 'none'}.`,
    hot.length > 0 ? `Most-changed source files, last 60 days:\n${bullets(hot.map(([path, seen]) => `${path} (${seen.recent})`), 25)}` : '',
    commits.length > 0 ? `Recent commits:\n${bullets(commits, 30)}` : '',
    milestones.length > 0 ? `GitHub milestones: ${milestones.join(', ')}.` : '',
    tags.length > 0 ? `Release tags: ${tags.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Sort: the unsorted files, git since the last sort grouped by feature, and each feature's detected signals. */
async function sortFacts($: $, place: Place, roadmap: Roadmap): Promise<string> {
  const root = place.root
  const evidence = await readEvidence($, root)
  const head = await headOf($, root)
  const fromCommit =
    roadmap.synced_commit !== null && head !== null && (await git($, root, ['merge-base', '--is-ancestor', roadmap.synced_commit, head])) !== null
  const range = fromCommit ? [`${roadmap.synced_commit}..HEAD`] : [`--since=${roadmap.synced_at ?? roadmap.last_touched}`]
  const log = (await git($, root, ['log', ...range, '--no-merges', '--date=short', '--pretty=format:@@%h %ad %s', '--name-only', '-n', '60'], 30_000)) ?? ''
  const commits: string[] = []
  const changed = new Set<string>()
  for (const line of log.split('\n')) {
    if (line.startsWith('@@')) commits.push(line.slice(2))
    else if (line.trim() && !line.startsWith('.claude/')) changed.add(line.trim())
  }
  for (const path of parseStatus((await git($, root, ['status', '--porcelain'])) ?? '')) if (!path.startsWith('.claude/')) changed.add(path)

  const owner = (file: string) =>
    roadmap.features.find(feature => feature.related_files.some(related => file === related || file.startsWith(`${related.replace(/\/$/, '')}/`)))
  const byFeature = new Map<string, string[]>()
  const loose: string[] = []
  for (const file of changed) {
    const feature = owner(file)
    if (feature) byFeature.set(feature.id, [...(byFeature.get(feature.id) ?? []), file])
    else if (!isTestFile(file)) loose.push(file)
  }
  const unassigned = await read($, unassignedFiles)
  const features = roadmap.features.map(feature => {
    const signals = signalsOf(evidence?.features[feature.id])
    const extra = [
      feature.depends_on.length > 0 ? `waits on ${feature.depends_on.join(', ')}` : null,
      feature.parked_reason ? `parked: ${feature.parked_reason}` : null,
      feature.pinned ? 'pinned' : null,
      feature.note ? `note: ${feature.note.replace(/\n/g, ' / ')}` : 'no note',
    ].filter(Boolean)
    return `${feature.id} · ${feature.status}${feature.milestone ? ` · ${feature.milestone}` : ''} · ${feature.kind === 'ui' ? `UI ${feature.ui_state}` : 'logic'} · works ${feature.functional_state}${signals.length > 0 ? ` · ${signals.join(', ')}` : ''} · ${feature.title} · ${extra.join(' · ')}`
  })

  const unsorted = evidence?.unsorted ?? []
  return [
    unsorted.length > 0 ? `Unsorted files (new, no feature claims them):\n${bullets(unsorted, 100)}` : 'Unsorted files: none.',
    `Since the last sort (${fromCommit ? `commit ${roadmap.synced_commit?.slice(0, 7)}` : (roadmap.synced_at ?? roadmap.last_touched)}): ${commits.length} commits.`,
    commits.length > 0 ? bullets(commits, 60) : '',
    byFeature.size > 0 ? `Changed files of tracked features:\n${bullets([...byFeature].map(([id, paths]) => `${id}: ${paths.slice(0, 8).join(', ')}`), 40)}` : '',
    loose.length > 0 ? `Other changed files no feature claims (configs, docs, tests included):\n${bullets(loose.filter(path => !unsorted.includes(path)), 60)}` : '',
    unassigned.length > 0 ? `Files Claude edited this session while no feature was in progress:\n${bullets(unassigned, 40)}` : '',
    `Milestones: ${roadmap.milestones.map(milestone => `${milestone.id} (${milestone.title})`).join(', ') || 'none'}.`,
    `Features (id · status · milestone · UI · works · detected signals · title):\n${features.join('\n')}`,
    `Where it says the user left off: ${roadmap.where_i_left_off || '(nothing yet)'}`,
    roadmap.decisions.length > 0 ? `Decisions so far (newest first):\n${bullets(roadmap.decisions.map(decision => decision.text), 8)}` : 'No decisions recorded yet: record key choices you find in the commits.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Next: the next-up feature, what it touches, and what the evidence says about it. */
async function nextFacts($: $, place: Place, roadmap: Roadmap): Promise<string> {
  const next = nextUp(roadmap)
  if (!next) return 'Nothing is in progress, queued or not started: there is no next feature. Ask the user what comes next.'
  const ev = (await readEvidence($, place.root))?.features[next.id]
  const nowMs = await $.clock.now()
  return [
    `Next up: ${next.title} (${next.id}), ${next.status.replace('_', ' ')}${next.milestone ? `, milestone ${next.milestone}` : ''}.`,
    next.description ? `What it is: ${next.description}` : '',
    next.note ? `Catch-up note:\n${next.note}` : '',
    next.depends_on.length > 0 ? `Waits on: ${next.depends_on.join(', ')}` : '',
    next.blocker_reason ? `Blocked: ${next.blocker_reason}` : '',
    next.related_files.length > 0 ? `Its files:\n${bullets(next.related_files, 25)}` : 'No files yet: it has not been started.',
    ev ? `Evidence: ${signalsOf(ev).join(', ') || 'no problems found'}; tests ${ev.tests_status}; last change ${ago(ev.last_change, nowMs)}.` : '',
    next.last_conversation ? `Last session on it: ${next.last_conversation.title ?? next.last_conversation.session_id}, ${ago(next.last_conversation.at, nowMs)}.` : '',
    `Where the user left off: ${roadmap.where_i_left_off || '(nothing yet)'}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

// ---------------------------------------------------------------------------
// Working alongside Claude

/**
 * The tools go in the prompt's tool list only where they're used: update,
 * detect and context where the project is set up; setup and context once the
 * person ran /nowhat to set it up. Elsewhere they stay deferred: no tokens.
 */
async function offerTools($: $, hasData: boolean, settingUp = false) {
  await $.tool.register({ ...UPDATE_SPEC, isDeferred: !hasData })
  await $.tool.register({ ...DETECT_SPEC, isDeferred: !hasData && !settingUp })
  await $.tool.register({ ...CONTEXT_SPEC, isDeferred: !hasData && !settingUp })
  await $.tool.register({ ...SETUP_SPEC, isDeferred: !settingUp })
}

/** The person asked for setup (/nowhat, or the sidebar's button): only now may setup save and register. */
async function requestSetup($: $): Promise<void> {
  await update($, setupRequested, () => true)
  const place = await placeOf($)
  await offerTools($, await $.fs.exists(`${place.root}/${DATA_FILE}`), true)
}

/** A prompt /nowhat queued: a command can't start a turn itself, so the turn's end sends it. */
let pendingPrompt: string | null = null

async function sendPending($: $): Promise<void> {
  const text = pendingPrompt
  if (text === null) return
  pendingPrompt = null
  try {
    await $.prompt.submit({ text, asUser: true })
  } catch {
    await fillPrompt($, text)
  }
}

/** Where a turn can't be started, the prompt goes in the composer: one Enter sends it. */
async function fillPrompt($: $, text: string): Promise<void> {
  const filled = await $.prompt.fill({ text }).catch(() => ({ isFilled: false }))
  $.ui.toast(filled.isFilled ? 'Press Enter to send it to Claude' : 'Use the sidebar button to start it')
}

/** "Set up with Claude", "Sort with Claude", "Continue with Claude": the only parts that spend tokens. */
async function startTurn($: $, text: string): Promise<void> {
  try {
    await $.prompt.submit({ text, asUser: true })
  } catch {
    await fillPrompt($, text)
  }
}

function refusal(errors: readonly string[]): string {
  return `Nothing was saved:\n${bullets(errors, 20)}`
}

const progressLine = (roadmap: Roadmap) => {
  const p = progress(roadmap)
  return `${p.overall ?? 0}% overall (UI ${p.ui ?? '-'}%, functional ${p.functional ?? '-'}%)`
}

async function fileEdited($: $, place: Place, path: string) {
  const relative = projectPath(place, path)
  if (relative === null || !(await isOn($, place.root))) return
  editedThisTurn = true

  const active = await read($, activeFeature)
  if (active !== null) {
    const filed = await serial(async () => {
      const loaded = await loadRoadmap($, place.root)
      const feature = loaded.roadmap?.features.find(one => one.id === active)
      if (!loaded.roadmap || !feature || feature.status !== 'in_progress') return false
      const stamped = await stamp($)
      if (feature.related_files.includes(relative)) {
        // Already its file: only note that this session worked on it (once per session).
        const touched = touchSession(feature, stamped.conversation)
        if (touched !== feature) {
          await saveRoadmap($, place.root, { ...loaded.roadmap, features: loaded.roadmap.features.map(one => (one.id === active ? touched : one)) })
        }
        return true
      }
      const applied = applyUpdate(loaded.roadmap, { changes: [{ id: active, add_files: [relative] }] }, stamped)
      if (applied.roadmap) await saveRoadmap($, place.root, applied.roadmap)
      return applied.roadmap !== null
    })
    if (filed) return
    // The active feature left progress some other way: edits are unassigned from here on.
    await update($, activeFeature, () => null)
  }
  await update($, unassignedFiles, files => (files.includes(relative) ? files : [...files, relative].slice(-50)))
}

/** A test run of Claude's: record what it says about each test file, then re-read the evidence. */
async function testsRan($: $, output: string, ok: boolean) {
  const place = await placeOf($)
  if (!(await isOn($, place.root))) return
  const evidence = await readEvidence($, place.root)
  if (!evidence) return
  const now = await nowIso($)
  const parsed = parseTestRun(output, evidence.project.tests, ok)
  if (parsed.failing.length === 0 && parsed.passing.length === 0) return
  const results = { ...evidence.test_results }
  for (const test of parsed.passing) results[test] = { ok: true, at: now }
  for (const test of parsed.failing) results[test] = { ok: false, at: now }
  await $.fs.write(`${place.root}/${EVIDENCE_FILE}`, `${JSON.stringify({ ...evidence, test_results: results }, null, 2)}\n`)
  await detect($, { hosts: 'skip', tests: false })
}

// ---------------------------------------------------------------------------
// The pane

// ---------------------------------------------------------------------------
// All projects

const mtimeOf = async ($: $, path: string) => ((await $.fs.exists(path)) ? (await $.fs.stat(path)).mtimeMs : 0)

/** Each project's summary, kept until its roadmap or evidence file changes (or the hour turns). */
const summaries = new Map<string, { key: string; summary: ProjectSummary }>()

/** Every registered project's card, most recently active first. */
async function loadProjects($: $, here: string): Promise<ProjectSummary[]> {
  const registry = await readRegistry($)
  const nowMs = await $.clock.now()
  const projects: ProjectSummary[] = []
  for (const entry of registry) {
    const key = `${await mtimeOf($, `${entry.path}/${DATA_FILE}`)}:${await mtimeOf($, `${entry.path}/${EVIDENCE_FILE}`)}:${Math.floor(nowMs / 3_600_000)}`
    const cached = summaries.get(entry.path)
    if (cached && cached.key === key) {
      projects.push({ ...cached.summary, isHere: entry.path === here })
      continue
    }
    const loaded = await readRoadmap($, entry.path)
    const evidence = loaded.roadmap ? await readEvidence($, entry.path) : null
    const summary = summarize(
      {
        path: entry.path,
        name: entry.name,
        isHere: entry.path === here,
        roadmap: loaded.roadmap,
        exists: loaded.exists,
        evidence: evidence?.features ?? {},
        live: evidence?.live ? evidence.live.ok : null,
      },
      nowMs,
    )
    summaries.set(entry.path, { key, summary })
    projects.push(summary)
  }
  return sortProjects(projects)
}

async function setView($: $, view: 'project' | 'all'): Promise<void> {
  await update($, paneView, () => view)
  await $.store.set('paneView', view)
}

async function copyPath($: $, path: string): Promise<void> {
  const copied = await $.ui.copy({ text: path })
  $.ui.toast(copied.isCopied ? 'Path copied. Open it in a new Claude session.' : path)
}

/** While the all-projects view shows, a change to any project's roadmap redraws it. */
let seenProjects = ''

async function pollProjects($: $): Promise<void> {
  if ((await read($, paneView)) !== 'all') return
  const stamps: string[] = []
  for (const entry of await readRegistry($)) stamps.push(`${entry.path}:${await mtimeOf($, `${entry.path}/${DATA_FILE}`)}`)
  const seen = stamps.join('|')
  if (seen === seenProjects) return
  seenProjects = seen
  await update($, revision, n => n + 1)
}

/** Whether the sidebar shows now, and the commit last seen: what the timers below act on. */
let paneShown = false
let seenHead: string | null = null

async function isPaneShown($: $): Promise<boolean> {
  try {
    return (await $.ui.panes()).some(pane => pane.id === PANE && pane.isShown && pane.isPlaced)
  } catch {
    return false
  }
}

/** Opening the sidebar re-checks, unless a check finished in the last minute. */
async function watchPane($: $): Promise<void> {
  const shown = await isPaneShown($)
  const opened = shown && !paneShown
  paneShown = shown
  if (opened && Date.now() - lastDetectAt > 60_000) await detect($, { hosts: 'cached', tests: false })
}

/** A new commit (Codex, a terminal, another session) re-checks within HEAD_POLL_MS. */
async function watchHead($: $): Promise<void> {
  const place = await placeOf($)
  if (!(await $.fs.exists(`${place.root}/${DATA_FILE}`))) return
  const head = await headOf($, place.root)
  if (head === null) return
  const moved = seenHead !== null && head !== seenHead
  seenHead = head
  if (moved) await detect($, { hosts: 'cached', tests: false })
}

let seenMtime = -1
/** Changes made outside this session reach the pane within seconds: a stat per tick. */
async function pollRoadmap($: $): Promise<void> {
  const place = await placeOf($)
  if (!(await isOn($, place.root))) return
  const path = `${place.root}/${DATA_FILE}`
  const mtime = (await $.fs.exists(path)) ? (await $.fs.stat(path)).mtimeMs : 0
  if (mtime === seenMtime) return
  seenMtime = mtime
  await serial(() => loadRoadmap($, place.root))
  await update($, revision, n => n + 1)
}

/** Remembered across sessions: which sections the person keeps open. */
async function restoreSections($: $): Promise<void> {
  const saved = await $.store.get('toggledSections')
  if (Array.isArray(saved)) await update($, openSections, () => saved.filter((one): one is string => typeof one === 'string'))
  const view = await $.store.get('paneView')
  if (view === 'project' || view === 'all') await update($, paneView, () => view)
  const tab = await $.store.get('tab')
  if (typeof tab === 'string' && (TABS as readonly string[]).includes(tab)) await update($, paneTab, () => tab as Tab)
}

async function toggleSection($: $, id: string): Promise<void> {
  await update($, openSections, open => (open.includes(id) ? open.filter(one => one !== id) : [...open, id]))
  await $.store.set('toggledSections', await read($, openSections))
}

async function setTab($: $, tab: Tab): Promise<void> {
  await update($, paneTab, () => tab)
  await $.store.set('tab', tab)
}

/** Quick capture: the idea goes into the backlog straight in the file. No tokens. */
async function capture($: $, line: string): Promise<void> {
  const place = await placeOf($)
  const result = await serial(async () => {
    const loaded = await loadRoadmap($, place.root)
    if (!loaded.roadmap) return { error: 'Set noWhat up first.' }
    const captured = captureIdea(loaded.roadmap, line, await nowIso($))
    if ('error' in captured) return captured
    await saveRoadmap($, place.root, captured.roadmap)
    return captured
  })
  if ('error' in result) {
    if (line.trim() !== '') $.ui.toast(result.error)
    return
  }
  await update($, captureGeneration, n => n + 1)
}

async function copySummary($: $, text: string): Promise<void> {
  const copied = await $.ui.copy({ text })
  $.ui.toast(copied.isCopied ? 'Weekly summary copied' : 'Could not copy: open Weekly summary and select it')
}

/** Refresh: everything but the test suites, hosts included. Zero tokens. */
async function refresh($: $): Promise<void> {
  await detect($, { hosts: 'refresh', tests: false })
}

/** Moves a queued feature one place up or down, straight in the file: no tokens. */
async function moveQueued($: $, id: string, delta: -1 | 1): Promise<void> {
  const place = await placeOf($)
  await serial(async () => {
    const loaded = await loadRoadmap($, place.root)
    if (!loaded.roadmap) return
    const order = loaded.roadmap.features.filter(feature => feature.status === 'queued').map(feature => feature.id)
    const from = order.indexOf(id)
    const to = from + delta
    if (from === -1 || to < 0 || to >= order.length) return
    order.splice(to, 0, ...order.splice(from, 1))
    await saveRoadmap($, place.root, {
      ...loaded.roadmap,
      features: reorderQueue(loaded.roadmap.features, order),
      last_touched: await nowIso($),
    })
  })
}

/** Pins or unpins a feature's status, straight in the file: detection then leaves it alone. */
async function togglePin($: $, id: string): Promise<void> {
  const place = await placeOf($)
  await serial(async () => {
    const loaded = await loadRoadmap($, place.root)
    if (!loaded.roadmap) return
    await saveRoadmap($, place.root, {
      ...loaded.roadmap,
      features: loaded.roadmap.features.map(feature => (feature.id === id ? { ...feature, pinned: !feature.pinned } : feature)),
    })
  })
}

/** "Continue with Claude": starts a turn on the next-up feature. */
const continueWith = ($: $, feature: Feature) => startTurn($, nextPrompt(feature))

/** Notes this visit, and what git did since the last one, once per session. */
async function recordVisit($: $, root: string): Promise<void> {
  if (await read($, visitRecorded)) return
  await update($, visitRecorded, () => true)
  const key = `visit:${root}`
  const last = (await $.store.get(key)) as { at?: string; head?: string | null } | undefined
  const head = await headOf($, root)
  await $.store.set(key, { at: await nowIso($), head })
  if (!last?.at) return
  const at = last.at
  await update($, previousVisit, () => at)
  const range =
    last.head && head && last.head !== head && (await git($, root, ['merge-base', '--is-ancestor', last.head, head])) !== null
      ? [`${last.head}..HEAD`]
      : [`--since=${at}`]
  const subjects = ((await git($, root, ['log', ...range, '--no-merges', '--format=%s', '-n', '30'])) ?? '').trim().split('\n').filter(Boolean)
  await update($, visitCommits, () => subjects)
}

// ---------------------------------------------------------------------------

export const register: Register = (on, options) => {
  settings.runTests = options.run_tests !== false
  settings.checkHosts = options.check_hosts !== false

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const place = await placeOf($)
    const loaded = await serial(() => loadRoadmap($, place.root))
    const turnedOn = loaded.exists && (await isOn($, place.root))
    await offerTools($, turnedOn, await read($, setupRequested))
    await $.command.register({
      name: 'nowhat',
      description: 'Set up noWhat in this project, or show and hide its sidebar',
    })
    await restoreSections($)
    if (turnedOn) {
      void $.ui.open({ id: PANE, title: TITLE })
      await recordVisit($, place.root)
      // Fresh evidence shortly after start, in the background: the session isn't held up.
      $.clock.after(1500, () => {
        void detect($, { hosts: 'cached', tests: false })
      })
    }
    // Zero-token upkeep: the file every 3s, the sidebar opening, new commits, and a re-check every 5 minutes while it shows.
    $.clock.every(3000, () => {
      void pollRoadmap($)
      void watchPane($)
    })
    $.clock.every(HEAD_POLL_MS, () => {
      void watchHead($)
    })
    $.clock.every(RECHECK_MS, () => {
      if (paneShown) void detect($, { hosts: 'cached', tests: false })
    })
    $.clock.every(15_000, () => {
      void pollProjects($)
    })
    // Keeps "checked 40s ago" honest while the sidebar shows.
    $.clock.every(TICK_MS, () => {
      if (paneShown) $.ui.invalidate('ui.render')
    })

    return started
  })

  // /nowhat: set up a project that has no features file yet; otherwise show or hide the sidebar.
  on('command.run', { command: 'nowhat' }, async ($, e) => {
    const place = await placeOf($)
    const word = e.args.trim().split(/\s+/)[0] ?? ''
    if (word !== '' && word !== 'setup') return { text: 'Use /nowhat on its own (/nowhat setup redoes the setup).' }
    const loaded = await serial(() => loadRoadmap($, place.root))

    if (!loaded.exists || word === 'setup') {
      // Setup needs a turn of Claude's, which a command can't start while it runs: the turn's end sends it.
      await requestSetup($)
      pendingPrompt = word === 'setup' ? `${SETUP_PROMPT} Replace the existing features (replace: true): the user asked to redo the setup.` : SETUP_PROMPT
      $.clock.after(4000, () => {
        if (pendingPrompt !== null) void fillPrompt($, pendingPrompt).then(() => (pendingPrompt = null))
      })
      void $.ui.open({ id: PANE, title: TITLE })
      return { text: 'noWhat: setting up. Claude groups the code into features.' }
    }

    // You ran it here: this project belongs in the all-projects list.
    if (loaded.roadmap) await registerProject($, place.root, loaded.roadmap.name, loaded.roadmap.project_id, await nowIso($))

    // Show or hide: the nearest thing to a shortcut a mod can offer.
    const open = (await $.ui.panes()).find(pane => pane.id === PANE)
    if (open?.isPlaced && open.isShown) {
      await $.ui.close({ id: PANE })
      return {}
    }
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    if (opened.isPlaced) return {}

    // Nothing here draws panes (a headless run): print the summary instead.
    if (!loaded.roadmap) return { text: `${DATA_FILE} has errors:\n${bullets(loaded.errors, 20)}` }
    return { text: summaryText(loaded.roadmap, await $.clock.now()) }
  })

  // The standing rules: fixed text, so the prompt cache keeps it.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const place = await placeOf($)
    if (!(await $.fs.exists(`${place.root}/${DATA_FILE}`)) || !(await isOn($, place.root))) return composed

    return {
      sections: [...composed.sections, { id: 'nowhat:rules', text: await rulesText($), scope: 'session' }],
    }
  })

  // Where things stand, beside a prompt: sent again only when it changed.
  on('prompt.submit', async ($, e, next) => {
    const place = await placeOf($)
    if (!(await isOn($, place.root))) return next(e)
    const loaded = await serial(() => loadRoadmap($, place.root))
    if (!loaded.exists) return next(e)
    const line = loaded.roadmap
      ? contextLine(loaded.roadmap, await read($, activeFeature))
      : `${DATA_FILE} has errors, so noWhat can't record anything until they're fixed:\n${bullets(loaded.errors, 10)}`
    if (line === (await read($, lastContext))) return next(e)
    await update($, lastContext, () => line)

    return next({ ...e, context: [...(e.context ?? []), line] })
    // A status line that fails to build never holds up the prompt.
  }).catch(($, e, next) => next(e))

  // A turn that edited files ends with their evidence re-read: no tokens.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // The prompt /nowhat queued: sent now, not awaited, so this turn's end isn't held up by the next.
    if (pendingPrompt !== null) void sendPending($)
    if (editedThisTurn) {
      editedThisTurn = false
      $.clock.after(0, () => {
        void detect($, { hosts: 'skip', tests: false })
      })
    }
    return result
  })

  on('tool.call', { tool: 'mcp__nowhat__setup' }, async ($, e) => {
    try {
      if (!(await read($, setupRequested))) {
        return { deny: "The user hasn't run /nowhat in this project. noWhat is set up only where they run it: don't set it up on your own." }
      }
      const place = await placeOf($)
      const input = e as unknown as { name?: unknown; where_i_left_off?: unknown; features?: unknown; milestones?: unknown; replace?: unknown }

      const drafted = await serial(async () => {
        const loaded = await loadRoadmap($, place.root)
        if (loaded.exists && input.replace !== true) {
          return { ok: false as const, deny: `${DATA_FILE} already exists. Pass replace: true only if the user ran /nowhat setup to start over.` }
        }
        const { now, conversation } = await stamp($)
        const features = (Array.isArray(input.features) ? input.features : []) as unknown[]
        const leftOff = typeof input.where_i_left_off === 'string' ? input.where_i_left_off : ''
        const given = new Set(
          features.flatMap(feature =>
            typeof feature === 'object' && feature !== null && typeof (feature as Record<string, unknown>).status === 'string'
              ? [String((feature as Record<string, unknown>).id)]
              : [],
          ),
        )
        const checked = validate(
          {
            name: input.name,
            last_touched: now,
            where_i_left_off: leftOff,
            left_off_at: leftOff.trim() ? now : null,
            synced_at: now,
            synced_commit: await headOf($, place.root),
            milestones: input.milestones,
            // A feature given no status gets one from the evidence below; the placeholder never shows.
            features: features.map(feature =>
              typeof feature === 'object' && feature !== null
                ? { status: 'not_started', ...feature, updated_at: now, last_conversation: conversation, thumbnail: null }
                : feature,
            ),
            recent_changes: [],
          },
          now,
          { strict: true },
        )
        if (!checked.roadmap) return { ok: false as const, deny: refusal(checked.errors) }
        return { ok: true as const, roadmap: checked.roadmap, given, now }
      })
      if (!drafted.ok) return { deny: drafted.deny }

      // States come from evidence, not from the draft: statuses nobody gave are derived, then reconciled.
      const evidence = await gatherEvidence($, place, drafted.roadmap, { hosts: 'refresh', tests: false })
      const nowMs = Date.parse(drafted.now)
      const derived: Roadmap = {
        ...drafted.roadmap,
        features: drafted.roadmap.features.map(feature =>
          drafted.given.has(feature.id) ? feature : { ...feature, status: initialStatus(evidence.features[feature.id], nowMs) },
        ),
      }
      const roadmap: Roadmap = { ...reconcile(derived, evidence.features, drafted.now).roadmap, recent_changes: [] }

      const identified: Roadmap = { ...roadmap, project_id: roadmap.project_id ?? newProjectId() }
      await serial(() => saveRoadmap($, place.root, identified))
      await registerProject($, place.root, identified.name, identified.project_id, drafted.now)
      await offerTools($, true)
      void $.ui.open({ id: PANE, title: TITLE })

      const counts = progress(roadmap).counts
      return {
        result: [
          `Saved ${roadmap.features.length} features to ${DATA_FILE}: ${progressLine(roadmap)}.`,
          `Done ${counts.done}, in progress ${counts.in_progress}, blocked ${counts.blocked}, queued ${counts.queued}, not started ${counts.not_started}.`,
          describeDetection(evidence, []),
        ].join('\n'),
      }
    } catch (error) {
      return { deny: `nowhat: ${messageOf(error)}` }
    }
  })

  on('tool.call', { tool: 'mcp__nowhat__context' }, async ($, e) => {
    try {
      const place = await placeOf($)
      const purpose = (e as unknown as { purpose?: unknown }).purpose
      const loaded = await serial(() => loadRoadmap($, place.root))

      if (purpose === 'setup') {
        if (!(await read($, setupRequested))) return { deny: "The user hasn't run /nowhat in this project: don't set it up on your own." }
        return { result: `${await promptText($, 'setup')}\n\n${await setupFacts($, place)}` }
      }
      if (purpose === 'sort' || purpose === 'next') {
        if (!(await isOn($, place.root))) return { deny: OFF }
        if (!loaded.exists) return { deny: 'This project has no noWhat features yet: the user can run /nowhat to set it up.' }
        if (!loaded.roadmap) return { deny: `Fix ${DATA_FILE} first:\n${bullets(loaded.errors, 20)}` }
        const facts = purpose === 'sort' ? await sortFacts($, place, loaded.roadmap) : await nextFacts($, place, loaded.roadmap)
        return { result: `${await promptText($, purpose)}\n\n${facts}` }
      }
      return { deny: 'purpose must be "setup", "sort" or "next"' }
    } catch (error) {
      return { deny: `nowhat: ${messageOf(error)}` }
    }
  })

  on('tool.call', { tool: 'mcp__nowhat__detect' }, async ($, e) => {
    try {
      const tests = (e as unknown as { tests?: unknown }).tests === true
      return { result: await detect($, { hosts: 'refresh', tests }) }
    } catch (error) {
      return { deny: `nowhat: ${messageOf(error)}` }
    }
  })

  on('tool.call', { tool: 'mcp__nowhat__update' }, async ($, e) => {
    try {
      const place = await placeOf($)
      const input = e as unknown as UpdateInput
      const head = input.synced === true ? await headOf($, place.root) : null

      if (!(await isOn($, place.root))) return { deny: OFF }
      return await serial(async () => {
        const loaded = await loadRoadmap($, place.root)
        if (!loaded.exists) return { deny: 'This project has no noWhat features yet. The user can run /nowhat to set it up.' }
        if (!loaded.roadmap) return { deny: `Fix ${DATA_FILE} first:\n${bullets(loaded.errors, 20)}` }

        const applied = applyUpdate(loaded.roadmap, input, { ...(await stamp($)), head })
        if (!applied.roadmap) return { deny: refusal(applied.errors) }
        await saveRoadmap($, place.root, applied.roadmap)

        // Edits are filed under the feature last put in progress; when it leaves progress, under none.
        const latest = applied.started[applied.started.length - 1]
        const active = await read($, activeFeature)
        if (latest !== undefined) await update($, activeFeature, () => latest)
        else if (active !== null && applied.stopped.includes(active)) await update($, activeFeature, () => null)

        return { result: `Saved: ${progressLine(applied.roadmap)}.` }
      })
    } catch (error) {
      return { deny: `nowhat: ${messageOf(error)}` }
    }
  })

  // File each edit under the active feature, or leave it unassigned: never a guess.
  on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit'] }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran
    const input = e as unknown as { file_path?: unknown; notebook_path?: unknown }
    const path = typeof input.file_path === 'string' ? input.file_path : input.notebook_path
    if (typeof path === 'string') {
      try {
        await fileEdited($, await placeOf($), path)
      } catch {
        // Bookkeeping never fails the edit.
      }
    }
    return ran
  }).catch(($, e, next) => next(e))

  // Claude's own test runs are evidence too: their output is read at no cost.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && isTestCommand(e.command)) {
      const output = ran.text ?? ''
      const ok = ran.isError !== true
      $.clock.after(0, () => {
        void testsRan($, output, ok)
      })
    }
    return ran
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    await read($, revision)
    const place = await placeOf($)
    const turnedOn = await isOn($, place.root)
    const loaded = turnedOn ? await readRoadmap($, place.root) : { exists: false as const, roadmap: null, errors: [] as [] }
    const evidence = loaded.roadmap ? await readEvidence($, place.root) : null
    const view = (await read($, paneView)) ?? 'project'
    const projects = await loadProjects($, place.root)

    return renderPane(
      el,
      {
        surface: e.surface,
        exists: loaded.exists,
        roadmap: loaded.roadmap,
        errors: loaded.errors,
        evidence: evidence?.features ?? {},
        capabilities: {
          tests: (evidence?.project.test_commands.length ?? 0) > 0,
          hosts: (evidence?.hosts ?? []).some(host => host.kind !== 'dotenv'),
          git: evidence?.project.git ?? true,
        },
        live: evidence?.live ?? null,
        launch: evidence?.launch ? { kind: evidence.launch.kind, checks: evidence.launch.checks } : null,
        checkedAt: evidence?.checked_at ?? null,
        checking: await read($, checking),
        nowMs: await $.clock.now(),
        open: await read($, openSections),
        expanded: await read($, expandedFeature),
        active: await read($, activeFeature),
        tab: await read($, paneTab),
        previousVisit: await read($, previousVisit),
        visitCommits: await read($, visitCommits),
        columns: e.props.bodyColumns,
        captureKey: `capture:${await read($, captureGeneration)}`,
        view,
        projects,
        unsorted: evidence?.unsorted ?? [],
        expandedProject: await read($, expandedProject),
        home: (await $.env.get('HOME')) ?? '',
      },
      {
        toggleSection: id => void toggleSection($, id),
        toggleFeature: id => void update($, expandedFeature, current => (current === id ? null : id)),
        moveQueued: (id, delta) => void moveQueued($, id, delta),
        continueWith: feature => void continueWith($, feature),
        togglePin: id => void togglePin($, id),
        setView: view => void setView($, view),
        toggleProject: path => void update($, expandedProject, current => (current === path ? null : path)),
        copyPath: path => void copyPath($, path),
        refresh: () => void refresh($),
        setTab: tab => void setTab($, tab),
        capture: text => void capture($, text),
        copySummary: text => void copySummary($, text),
        setup: () => void requestSetup($).then(() => startTurn($, SETUP_PROMPT)),
        sort: () => void startTurn($, SORT_PROMPT),
      },
    )
  })

  // /clear, /resume and /branch reset $.state: bring back the sections the person keeps open.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await restoreSections($)
    return next(e)
  })
}
