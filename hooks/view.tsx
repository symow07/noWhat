// The noWhat sidebar: one project at a glance, drawn from plain data. No `$`
// here: register.tsx reads the files and state and hands over closures.
//
// The layout, top to bottom: header (name, %, health, refresh) · an alert strip
// only when something is wrong · Next up · a line to capture an idea · four tabs
// (Features, Needs you, Decisions, Launch) · closed sections (milestones, since
// last visit, scope, weekly summary). Every row is a name and one pill; the
// rest opens on click. Two accents only: blue for progress and the one button,
// red for what broke or waits on the person. Everything else is grey.

import type { Elements } from 'claude-code'

import type { FeatureEvidence } from './detect'
import { type Alert, STATUS_WORDS, alertsOf, catchUp, healthOf, rabbitHoles, scopeWeek, shortDate, unblocks, waitingOn, weeklySummary } from './insights'
import { type LaunchCheck, type LaunchKind, launchTitle } from './launch'
import { type ProjectSummary } from './portfolio'
import { signalsOf } from './reconcile'
import { type Feature, type Roadmap, type Status, ago, isStale, nextUp, progressOf } from './schema'

/** A gap between UI and functional progress this wide (in points) is called out. */
export const GAP_ALERT = 15

/** Sections the person toggled away from their default (open or closed); none at first. */
export const OPEN_BY_DEFAULT: readonly string[] = []

export const TABS = ['features', 'needs', 'decisions', 'launch'] as const
export type Tab = (typeof TABS)[number]

export type PaneData = {
  /** Where it's drawn: the terminal gets text where other surfaces get images. */
  surface: string
  exists: boolean
  roadmap: Roadmap | null
  errors: string[]
  evidence: Readonly<Record<string, FeatureEvidence>>
  /** What this project lets detection see: a test command, a deploy host, git. */
  capabilities: { tests: boolean; hosts: boolean; git: boolean }
  live: { url: string; ok: boolean; status: number } | null
  /** The launch checklist, when the project is a store or web app. */
  launch: { kind: LaunchKind; checks: LaunchCheck[] } | null
  checkedAt: string | null
  /** A detection is running now. */
  checking: boolean
  nowMs: number
  /** Section ids toggled away from their default. */
  open: readonly string[]
  expanded: string | null
  active: string | null
  tab: Tab
  previousVisit: string | null
  visitCommits: readonly string[]
  /** Cells across the pane's body. */
  columns: number
  /** The capture field's key: a new one clears it after an idea is added. */
  captureKey: string
  /** This project's dashboard, or every project's card. */
  view: 'project' | 'all'
  /** Every registered project, most recently active first. */
  projects: readonly ProjectSummary[]
  /** New source files no feature claims. */
  unsorted: readonly string[]
  expandedProject: string | null
  /** The home directory, shown as ~ in paths. */
  home: string
}

export type PaneActions = {
  toggleSection: (id: string) => void
  toggleFeature: (id: string) => void
  moveQueued: (id: string, delta: -1 | 1) => void
  continueWith: (feature: Feature) => void
  togglePin: (id: string) => void
  setView: (view: 'project' | 'all') => void
  toggleProject: (path: string) => void
  copyPath: (path: string) => void
  refresh: () => void
  setTab: (tab: Tab) => void
  capture: (text: string) => void
  copySummary: (text: string) => void
  /** Starts Claude on the setup: groups the code into features. */
  setup: () => void
  /** Starts Claude on the unsorted files and the work since the last sort. */
  sort: () => void
}

type Table = Elements['desktop'] | Elements['terminal'] | Elements['vscode'] | Elements['mobile']

/**
 * Whether the surface draws images: every surface but the terminal, whose table may still list Svg.
 * Set at the top of renderPane, which runs synchronously, so one surface's render never sees another's.
 */
let drawsImages = true
const imageTable = (el: Table): el is Elements['desktop'] | Elements['vscode'] | Elements['mobile'] => drawsImages && 'Svg' in el

// ---------------------------------------------------------------------------
// Colour and shape: two accents, mid-tones that read on light and dark alike

const ACCENT = '#4A8FE7'
const ALERT = '#E5534B'
const GREY = '#8E8E93'
const TRACK = '#8E8E9333'

type Tone = 'accent' | 'alert' | 'neutral' | 'faint'
type Pill = { label: string; tone: Tone }

const TINT: Record<Tone, { fill: string; text: string; opacity: number }> = {
  accent: { fill: 'rgba(74,143,231,0.18)', text: ACCENT, opacity: 1 },
  alert: { fill: 'rgba(229,83,75,0.16)', text: ALERT, opacity: 1 },
  neutral: { fill: 'rgba(142,142,147,0.18)', text: GREY, opacity: 1 },
  faint: { fill: 'rgba(142,142,147,0.08)', text: GREY, opacity: 0.7 },
}
const TERMINAL_TONE: Record<Tone, { color?: string; dim?: boolean }> = {
  accent: { color: 'suggestion' },
  alert: { color: 'error' },
  neutral: { dim: true },
  faint: { dim: true },
}

/** Every pill is this wide, so names start in one column. */
const PILL_WIDTH = 86
const PILL_CELLS = 13

const escapeXml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function pillSvg(pill: Pill, width = PILL_WIDTH): string {
  const tint = TINT[pill.tone]
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="18" viewBox="0 0 ${width} 18">` +
    `<rect width="${width}" height="18" rx="9" fill="${tint.fill}"/>` +
    `<text x="${width / 2}" y="12.6" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif" font-size="11" font-weight="600" fill="${tint.text}" fill-opacity="${tint.opacity}">${escapeXml(pill.label)}</text>` +
    '</svg>'
  )
}

/** One pill: an image where the surface draws SVG, padded coloured text where it doesn't. */
function pill(el: Table, value: Pill, width = PILL_WIDTH) {
  if (imageTable(el)) {
    const { Svg } = el
    return <Svg source={pillSvg(value, width)} alt={value.label} />
  }
  const { Text } = el
  const tone = TERMINAL_TONE[value.tone]
  return (
    <Text {...(tone.color ? { color: tone.color } : {})} {...(tone.dim ? { dimColor: true } : {})}>
      {value.label.padEnd(PILL_CELLS)}
    </Text>
  )
}

function svgBar(value: number, fill: string, width: number, height: number): string {
  const filled = Math.round((width * Math.max(0, Math.min(100, value))) / 100)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" rx="${height / 2}" fill="${TRACK}"/>` +
    (filled > 0 ? `<rect width="${Math.max(filled, height)}" height="${height}" rx="${height / 2}" fill="${fill}"/>` : '') +
    '</svg>'
  )
}

/** A bar as an image where the surface draws SVG, as block characters where it doesn't. */
function bar(el: Table, value: number, fill: string, cells: number, label: string, height = 4) {
  if (imageTable(el)) {
    const { Svg } = el
    // Cells are about 7.5 CSS px wide; a wider image is narrowed to the slot.
    return <Svg source={svgBar(value, fill, Math.max(60, Math.round(cells * 7.5)), height)} alt={label} />
  }
  const { Text } = el
  const width = Math.max(6, cells)
  const filled = Math.round((width * Math.max(0, Math.min(100, value))) / 100)
  return <Text dimColor>{'█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))}</Text>
}

/** A hairline across the pane. */
function rule(el: Table, cells: number) {
  if (imageTable(el)) {
    const { Svg } = el
    const width = Math.max(60, Math.round(cells * 7.5))
    return <Svg source={`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="1" viewBox="0 0 ${width} 1"><rect width="${width}" height="1" fill="${TRACK}"/></svg>`} alt="" />
  }
  const { Text } = el
  return <Text dimColor>{'─'.repeat(Math.max(6, cells))}</Text>
}

const pct = (value: number | null) => (value === null ? '–' : `${value}%`)

/** "checked just now", "checked 40s ago", "checked 3m ago": coarse, so the line doesn't flicker. */
export function checkedLabel(checkedAt: string | null, nowMs: number): string {
  if (checkedAt === null) return 'not checked yet'
  const seconds = Math.max(0, Math.floor((nowMs - Date.parse(checkedAt)) / 1000))
  if (seconds < 10) return 'checked just now'
  if (seconds < 60) return `checked ${Math.floor(seconds / 10) * 10}s ago`
  if (seconds < 3600) return `checked ${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `checked ${Math.floor(seconds / 3600)}h ago`
  return `checked ${Math.floor(seconds / 86_400)}d ago`
}

/** Whether a section shows its contents: its default, flipped if the person toggled it. */
function isOpen(id: string, toggled: readonly string[]): boolean {
  const byDefault = !/^(done:|drawer:|more:)/.test(id)
  return toggled.includes(id) ? !byDefault : byDefault
}

// ---------------------------------------------------------------------------
// The pane

export function renderPane(el: Table, data: PaneData, actions: PaneActions) {
  drawsImages = data.surface !== 'terminal'
  if (data.view === 'all' && data.projects.length > 0) return allProjects(el, data, actions)
  return thisProject(el, data, actions)
}

function thisProject(el: Table, data: PaneData, actions: PaneActions) {
  const { Box, Button, Text } = el
  if (!data.exists || !data.roadmap) {
    return (
      <Box flexDirection="column" gap={1}>
        {data.exists ? (
          <Box flexDirection="column">
            <Text bold color={ALERT}>
              .claude/nowhat.json has errors
            </Text>
            {data.errors.slice(0, 12).map(error => (
              <Text dimColor wrap="wrap">
                {error}
              </Text>
            ))}
          </Box>
        ) : (
          <Box flexDirection="column" gap={1}>
            <Box flexDirection="column">
              <Text bold>noWhat isn't set up here yet</Text>
              <Text dimColor wrap="wrap">
                Claude groups the code into features once. After that, everything is worked out from the code, git, tests and config.
              </Text>
            </Box>
            <Box>
              <Button key="setup" variant="primary" label="Set up with Claude" onPress={() => actions.setup()} />
            </Box>
          </Box>
        )}
        {allProjectsLink(el, data, actions)}
      </Box>
    )
  }

  const roadmap = data.roadmap
  const columns = Math.max(24, data.columns)

  return (
    <Box flexDirection="column" gap={1}>
      {header(el, roadmap, data, actions, columns)}
      {alertStrip(el, alertsOf(roadmap, data.evidence, data.live, data.nowMs))}
      {nextUpCard(el, roadmap, data, actions)}
      {captureLine(el, data, actions)}
      <Box flexDirection="column">
        {tabBar(el, roadmap, data, actions)}
        {rule(el, columns)}
        {tabBody(el, roadmap, data, actions)}
      </Box>
      <Box flexDirection="column">
        {rule(el, columns)}
        {drawer(el, roadmap, data, actions, columns)}
      </Box>
      {allProjectsLink(el, data, actions)}
    </Box>
  )
}

const HEALTH_DOT: Record<string, { color?: string; dim?: boolean }> = {
  thriving: { color: ACCENT },
  needs_you: { color: ALERT },
  stalled: { dim: true },
  steady: { dim: true },
}

function header(el: Table, roadmap: Roadmap, data: PaneData, actions: PaneActions, columns: number) {
  const { Box, Button, Markdown, Text } = el
  const p = progressOf(roadmap.features)
  const health = healthOf(roadmap, data.evidence, data.nowMs)
  const dot = HEALTH_DOT[health.kind] ?? { dim: true }
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1}>
        <Markdown text={`### ${roadmap.name.replace(/[#*_`[\]]/g, '')}`} />
        <Box flexDirection="row" columnGap={1} alignItems="center" flexShrink={0}>
          <Text bold>{pct(p.overall)}</Text>
          <Button key="refresh" plain onPress={() => actions.refresh()}>
            {data.checking ? '…' : '↻'}
          </Button>
        </Box>
      </Box>
      {bar(el, p.overall ?? 0, ACCENT, columns, `Overall ${pct(p.overall)}`)}
      <Box flexDirection="row" justifyContent="space-between">
        <Text>
          <Text {...(dot.color ? { color: dot.color } : { dimColor: true })}>●</Text>
          <Text dimColor> {health.label}</Text>
        </Text>
        <Text dimColor>{data.checking ? 'checking…' : checkedLabel(data.checkedAt, data.nowMs)}</Text>
      </Box>
    </Box>
  )
}

/** Only when something is wrong; otherwise nothing is drawn at all. */
function alertStrip(el: Table, alerts: readonly Alert[]) {
  const { Box, Text } = el
  if (alerts.length === 0) return null
  const shown = alerts.slice(0, 3)
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={ALERT} paddingX={1}>
      {shown.map(alert => (
        <Text wrap="wrap" key={`alert:${alert.kind}:${alert.text}`}>
          <Text bold color={ALERT}>
            {alert.label}:
          </Text>{' '}
          {alert.text}
        </Text>
      ))}
      {alerts.length > shown.length && <Text dimColor>+{alerts.length - shown.length} more</Text>}
    </Box>
  )
}

function nextUpCard(el: Table, roadmap: Roadmap, data: PaneData, actions: PaneActions) {
  const { Box, Button, Text } = el
  const next = nextUp(roadmap)
  if (!next) {
    return (
      <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
        <Text dimColor>NEXT UP</Text>
        <Text dimColor>Nothing next. Capture an idea below.</Text>
      </Box>
    )
  }
  const flag = rowPill(next, data.evidence[next.id], data)
  const line =
    (next.regressed ? `Broke: ${next.regressed.reason}, ${ago(next.regressed.at, data.nowMs)}.` : null) ??
    (next.note.split('\n')[0]?.trim() || null) ??
    next.blocker_reason ??
    (next.description || null)

  return (
    <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
      <Text dimColor>NEXT UP</Text>
      <Box flexDirection="row" columnGap={1} alignItems="center">
        <Text bold wrap="truncate-end">
          {next.title}
        </Text>
        {flag.tone === 'alert' ? pill(el, flag, 64) : null}
      </Box>
      {line ? (
        <Text dimColor wrap="truncate-end">
          {line}
        </Text>
      ) : null}
      <Box marginTop={1}>
        <Button key="continue" variant="primary" label="Continue with Claude" onPress={() => actions.continueWith(next)} />
      </Box>
    </Box>
  )
}

/** One line to drop an idea into the backlog. Enter adds it; no tokens. */
function captureLine(el: Table, data: PaneData, actions: PaneActions) {
  if (!('Input' in el)) return null
  const { Input } = el
  return <Input key={data.captureKey} placeholder="+ Capture an idea" submitLabel="add" onSubmit={value => actions.capture(value)} />
}

// ---------------------------------------------------------------------------
// Tabs

const TAB_LABEL: Record<Tab, string> = { features: 'Features', needs: 'Needs you', decisions: 'Decisions', launch: 'Launch' }

const needsYou = (roadmap: Roadmap) => roadmap.features.filter(feature => feature.status === 'blocked' && feature.blocked_on === 'you')

function tabBar(el: Table, roadmap: Roadmap, data: PaneData, actions: PaneActions) {
  const { Box, Button, Text } = el
  const tabs = TABS.filter(tab => tab !== 'launch' || data.launch !== null)
  const waiting = needsYou(roadmap).length
  const passed = data.launch ? data.launch.checks.filter(check => check.state === 'ok').length : 0
  const count: Record<Tab, string> = {
    features: String(roadmap.features.length),
    needs: String(waiting),
    decisions: String(roadmap.decisions.length),
    launch: data.launch ? `${passed}/${data.launch.checks.length}` : '',
  }
  return (
    <Box flexDirection="row" columnGap={2}>
      {tabs.map(tab => {
        const on = data.tab === tab
        return (
          <Button key={`tab:${tab}`} plain onPress={() => actions.setTab(tab)}>
            <Text {...(on ? { bold: true, underline: true } : { dimColor: true })}>{TAB_LABEL[tab]}</Text>
            <Text {...(tab === 'needs' && waiting > 0 ? { color: ALERT } : { dimColor: true })}> {count[tab]}</Text>
          </Button>
        )
      })}
    </Box>
  )
}

function tabBody(el: Table, roadmap: Roadmap, data: PaneData, actions: PaneActions) {
  const tab = data.tab === 'launch' && data.launch === null ? 'features' : data.tab
  if (tab === 'needs') return needsTab(el, roadmap, data, actions)
  if (tab === 'decisions') return decisionsTab(el, roadmap, data, actions)
  if (tab === 'launch' && data.launch) return launchTab(el, data.launch, data, actions)
  return featuresTab(el, roadmap, data, actions)
}

/** The one pill a row carries: what matters most about the feature right now. */
export function rowPill(feature: Feature, ev: FeatureEvidence | undefined, data: Pick<PaneData, 'nowMs' | 'capabilities'>): Pill {
  if (feature.regressed !== null) return { label: 'Broke', tone: 'alert' }
  // Blocked rows stay grey: the Needs you tab, in red, already says how many wait on the person.
  if (feature.status === 'blocked') return { label: feature.blocked_on === 'you' ? 'Needs you' : 'Blocked', tone: 'neutral' }
  if (feature.status !== 'done' && ev?.tests_status === 'fail') return { label: 'Tests failing', tone: 'alert' }
  if (feature.idea) return { label: 'Idea', tone: 'neutral' }
  // Set aside on purpose: nothing about it is news until it's picked up again.
  if (feature.status === 'parked') return { label: 'Parked', tone: 'neutral' }
  if (isStale(feature, ev?.last_change ?? null, data.nowMs)) return { label: 'Stale', tone: 'neutral' }
  if (feature.status === 'in_progress') return { label: 'In progress', tone: 'accent' }
  const p = progressOf([feature])
  if (feature.status === 'done') {
    return data.capabilities.tests && p.unverified.length > 0 ? { label: 'Unverified', tone: 'neutral' } : { label: 'Done', tone: 'faint' }
  }
  if (p.designedNotWorking.length > 0) return { label: 'UI ahead', tone: 'neutral' }
  if (data.capabilities.git && signalsOf(ev).includes('not wired in') && feature.status !== 'not_started') return { label: 'Not wired', tone: 'neutral' }
  const words: Record<Status, string> = { queued: 'Queued', not_started: 'Not started', parked: 'Parked', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' }
  return { label: words[feature.status], tone: 'neutral' }
}

const ORDER: Record<Status, number> = { in_progress: 0, queued: 1, blocked: 2, not_started: 3, parked: 4, done: 5 }
const rank = (feature: Feature) => (feature.regressed !== null ? -1 : ORDER[feature.status])

type Group = { id: string; title: string; features: Feature[]; isBacklog: boolean }

function groupsOf(roadmap: Roadmap): Group[] {
  const planned = roadmap.features.filter(feature => !feature.idea)
  const sorted = (features: Feature[]) =>
    features
      .map((feature, index) => ({ feature, index }))
      .sort((a, b) => rank(a.feature) - rank(b.feature) || a.index - b.index)
      .map(({ feature }) => feature)
  const groups: Group[] =
    roadmap.milestones.length > 0
      ? [
          ...roadmap.milestones.map(milestone => ({
            id: `m:${milestone.id}`,
            title: milestone.title,
            features: sorted(planned.filter(feature => feature.milestone === milestone.id)),
            isBacklog: false,
          })),
          { id: 'm:none', title: 'Other', features: sorted(planned.filter(feature => feature.milestone === null)), isBacklog: false },
        ]
      : [{ id: 'all', title: 'Features', features: sorted(planned), isBacklog: false }]
  const ideas = roadmap.features.filter(feature => feature.idea)
  return [...groups, { id: 'backlog', title: 'Backlog', features: ideas, isBacklog: true }].filter(group => group.features.length > 0)
}

function featuresTab(el: Table, roadmap: Roadmap, data: PaneData, actions: PaneActions) {
  const { Box, Button, Text } = el
  const queueOrder = roadmap.features.filter(feature => feature.status === 'queued').map(feature => feature.id)
  return (
    <Box flexDirection="column" gap={1} marginTop={1}>
      {unsortedGroup(el, data, actions)}
      {groupsOf(roadmap).map(group => {
        const live = group.features.filter(feature => feature.status !== 'done' || feature.regressed !== null)
        const done = group.features.filter(feature => feature.status === 'done' && feature.regressed === null)
        const showDone = isOpen(`done:${group.id}`, data.open)
        return (
          <Box flexDirection="column" key={`group:${group.id}`}>
            <Box flexDirection="row" justifyContent="space-between">
              <Text dimColor bold>
                {group.title.toUpperCase()}
              </Text>
              <Text dimColor>{group.isBacklog ? String(group.features.length) : `${done.length} / ${group.features.length}`}</Text>
            </Box>
            {live.map(feature => featureRow(el, feature, roadmap, queueOrder, data, actions))}
            {done.length > 0 && (
              <Button key={`section:done:${group.id}`} plain onPress={() => actions.toggleSection(`done:${group.id}`)}>
                <Text dimColor>
                  {showDone ? '▾' : '▸'} {done.length} done
                </Text>
              </Button>
            )}
            {showDone && done.map(feature => featureRow(el, feature, roadmap, queueOrder, data, actions))}
          </Box>
        )
      })}
    </Box>
  )
}

/** New files no feature claims, and the one button that sorts them (the only part besides Continue that spends tokens). */
function unsortedGroup(el: Table, data: PaneData, actions: PaneActions) {
  const { Box, Button, Text } = el
  if (data.unsorted.length === 0) return null
  const all = isOpen('more:unsorted', data.open)
  const shown = all ? data.unsorted : data.unsorted.slice(0, 4)
  return (
    <Box flexDirection="column" key="group:unsorted">
      <Box flexDirection="row" justifyContent="space-between">
        <Text dimColor bold>
          UNSORTED
        </Text>
        <Text dimColor>{String(data.unsorted.length)}</Text>
      </Box>
      {shown.map(path => (
        <Text dimColor wrap="truncate-start" key={`unsorted:${path}`}>
          {path}
        </Text>
      ))}
      {more(el, 'more:unsorted', data.unsorted.length - shown.length, 'more', data, actions)}
      <Button key="sort" plain onPress={() => actions.sort()}>
        <Text color={ACCENT}>Sort with Claude</Text>
      </Button>
    </Box>
  )
}

function featureRow(el: Table, feature: Feature, roadmap: Roadmap, queueOrder: readonly string[], data: PaneData, actions: PaneActions) {
  const { Box, Button, Text } = el
  const isOpenRow = data.expanded === feature.id
  return (
    <Box flexDirection="column" key={`row:${feature.id}`}>
      <Box flexDirection="row" columnGap={1} alignItems="center">
        {pill(el, rowPill(feature, data.evidence[feature.id], data))}
        <Button key={`feature:${feature.id}`} plain onPress={() => actions.toggleFeature(feature.id)}>
          <Text wrap="truncate-end" {...(isOpenRow ? { bold: true } : {})}>
            {feature.title}
          </Text>
        </Button>
      </Box>
      {isOpenRow && details(el, feature, roadmap, queueOrder, data, actions)}
    </Box>
  )
}

/** Everything about one feature, shown only when it's opened. */
function details(el: Table, feature: Feature, roadmap: Roadmap, queueOrder: readonly string[], data: PaneData, actions: PaneActions) {
  const { Box, Button, Text } = el
  const ev = data.evidence[feature.id]
  const { nowMs, capabilities } = data
  // A blocked feature's reason is already on its row in Needs you; in Features it's said here.
  const waiting = waitingOn(feature, roadmap, ev)
  const freed = unblocks(feature, roadmap)
  const state = feature.kind === 'ui' ? `UI ${feature.ui_state} · works ${feature.functional_state}` : `works ${feature.functional_state}`
  const proof = feature.verified_by === null ? null : { ran: 'Claude ran it', tests: 'tests pass', user: 'you said so' }[feature.verified_by]
  const evidence = ev
    ? [
        capabilities.git
          ? ev.files.some(file => file.wired === false)
            ? 'not referenced anywhere'
            : ev.files.some(file => file.wired === true)
              ? 'wired in'
              : null
          : null,
        capabilities.tests && ev.tests_status !== 'none' ? `tests ${ev.tests_status === 'pass' ? 'pass' : ev.tests_status === 'fail' ? 'fail' : 'not run yet'}` : null,
        ev.uncommitted ? 'uncommitted edits' : null,
        ...signalsOf(ev).filter(signal => /TODOs?$/.test(signal)),
      ].filter((part): part is string => part !== null)
    : []
  const hole = rabbitHoles(roadmap).find(one => one.feature.id === feature.id)
  const queuedAt = queueOrder.indexOf(feature.id)
  const section = (label: string, lines: readonly string[]) =>
    lines.length === 0 ? null : (
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>{label}</Text>
        {lines.map(line => (
          <Text wrap="wrap">{line}</Text>
        ))}
      </Box>
    )
  const action = (key: string, label: string, onPress: () => void) => (
    <Button key={key} plain onPress={onPress}>
      <Text color={ACCENT}>{label}</Text>
    </Button>
  )

  return (
    <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
      {feature.description !== '' && (
        <Text dimColor wrap="wrap">
          {feature.description}
        </Text>
      )}
      {feature.regressed && section('Broke', [`${feature.regressed.reason} · ${ago(feature.regressed.at, nowMs)}`])}
      {section(
        'Catch-up',
        feature.note
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean),
      )}
      {feature.status === 'parked' && feature.parked_reason && section('Parked because', [feature.parked_reason])}
      {section('Waiting on', waiting)}
      {freed.length > 0 && section('Unblocks', [freed.map(other => `${other.title} (${STATUS_WORDS[other.status]})`).join(', ')])}
      {section('State', [[state, proof, ...evidence].filter(Boolean).join(' · ')])}
      {hole && section('Sessions', [`${hole.sessions} since its state last changed`])}
      {ev && ev.commits.length > 0 && section('Recent commits', ev.commits.map(commit => `${ago(commit.at, nowMs)} · ${commit.subject}`))}
      {feature.last_conversation !== null &&
        section('Last session', [`${feature.last_conversation.title ?? feature.last_conversation.session_id} · ${ago(feature.last_conversation.at, nowMs)}`])}
      {feature.related_files.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Files</Text>
          <Text dimColor wrap="wrap">
            {feature.related_files.join('\n')}
          </Text>
        </Box>
      )}
      <Box marginTop={1} flexDirection="row" columnGap={2}>
        {action(`pin:${feature.id}`, feature.pinned ? 'Unpin status' : 'Pin status', () => actions.togglePin(feature.id))}
        {queuedAt > 0 && action(`up:${feature.id}`, 'Move up', () => actions.moveQueued(feature.id, -1))}
        {queuedAt !== -1 && queuedAt < queueOrder.length - 1 && action(`down:${feature.id}`, 'Move down', () => actions.moveQueued(feature.id, 1))}
      </Box>
    </Box>
  )
}

const more = (el: Table, id: string, hidden: number, label: string, data: PaneData, actions: PaneActions) => {
  const { Button, Text } = el
  if (hidden <= 0 && !isOpen(id, data.open)) return null
  const open = isOpen(id, data.open)
  return (
    <Button key={`section:${id}`} plain onPress={() => actions.toggleSection(id)}>
      <Text dimColor>{open ? '▾ fewer' : `▸ ${hidden} ${label}`}</Text>
    </Button>
  )
}

function needsTab(el: Table, roadmap: Roadmap, data: PaneData, actions: PaneActions) {
  const { Box, Button, Text } = el
  const waiting = needsYou(roadmap)
    .map(feature => ({ feature, freed: unblocks(feature, roadmap).length }))
    .sort((a, b) => b.freed - a.freed)
  if (waiting.length === 0) {
    return (
      <Box marginTop={1}>
        <Text dimColor>Nothing waits on you.</Text>
      </Box>
    )
  }
  const queueOrder = roadmap.features.filter(feature => feature.status === 'queued').map(feature => feature.id)
  const all = isOpen('more:needs', data.open)
  const shown = all ? waiting : waiting.slice(0, 5)
  return (
    <Box flexDirection="column" gap={1} marginTop={1}>
      {shown.map(({ feature, freed }) => (
        <Box flexDirection="column" key={`need:${feature.id}`}>
          <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
            <Button key={`feature:${feature.id}`} plain onPress={() => actions.toggleFeature(feature.id)}>
              <Text bold wrap="truncate-end">
                {feature.title}
              </Text>
            </Button>
            <Text dimColor>{freed > 0 ? `unblocks ${freed}` : ''}</Text>
          </Box>
          <Text dimColor wrap="wrap">
            {feature.blocker_reason ?? ''}
          </Text>
          {data.expanded === feature.id && details(el, feature, roadmap, queueOrder, data, actions)}
        </Box>
      ))}
      {more(el, 'more:needs', waiting.length - shown.length, 'more', data, actions)}
    </Box>
  )
}

function decisionsTab(el: Table, roadmap: Roadmap, data: PaneData, actions: PaneActions) {
  const { Box, Text } = el
  if (roadmap.decisions.length === 0) {
    return (
      <Box marginTop={1}>
        <Text dimColor wrap="wrap">
          No decisions yet. Claude records them as you work.
        </Text>
      </Box>
    )
  }
  const titles = new Map(roadmap.features.map(feature => [feature.id, feature.title]))
  const all = isOpen('more:decisions', data.open)
  const shown = all ? roadmap.decisions : roadmap.decisions.slice(0, 8)
  return (
    <Box flexDirection="column" gap={1} marginTop={1}>
      {shown.map((decision, index) => (
        <Box flexDirection="row" columnGap={2} key={`decision:${index}`}>
          <Box width={7} flexShrink={0}>
            <Text dimColor>{shortDate(decision.at)}</Text>
          </Box>
          <Box flexDirection="column" flexShrink={1}>
            <Text wrap="wrap">{decision.text}</Text>
            {decision.feature !== null && <Text dimColor>{titles.get(decision.feature) ?? decision.feature}</Text>}
          </Box>
        </Box>
      ))}
      {more(el, 'more:decisions', roadmap.decisions.length - shown.length, 'older', data, actions)}
    </Box>
  )
}

const MARK: Record<LaunchCheck['state'], { glyph: string; color?: string }> = {
  fail: { glyph: '✕', color: ALERT },
  unknown: { glyph: '?' },
  ok: { glyph: '✓' },
}

function launchTab(el: Table, launch: NonNullable<PaneData['launch']>, data: PaneData, actions: PaneActions) {
  const { Box, Text } = el
  const open = launch.checks.filter(check => check.state !== 'ok')
  const passed = launch.checks.filter(check => check.state === 'ok')
  const all = isOpen('more:launch', data.open)
  const shownPassed = all ? passed : passed.slice(0, Math.max(0, 6 - open.length))
  const row = (check: LaunchCheck) => {
    const mark = MARK[check.state]
    return (
      <Box flexDirection="row" columnGap={1} key={`check:${check.id}`}>
        <Box width={2} flexShrink={0}>
          <Text bold {...(mark.color ? { color: mark.color } : { dimColor: true })}>
            {mark.glyph}
          </Text>
        </Box>
        <Box width={18} flexShrink={0}>
          <Text wrap="truncate-end">{check.label}</Text>
        </Box>
        <Text dimColor wrap="truncate-end">
          {check.evidence}
        </Text>
      </Box>
    )
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text dimColor bold>
          {launchTitle(launch.kind).toUpperCase()}
        </Text>
        <Text dimColor>
          {passed.length} / {launch.checks.length}
        </Text>
      </Box>
      {open.map(row)}
      {shownPassed.map(row)}
      {more(el, 'more:launch', passed.length - shownPassed.length, 'more passed', data, actions)}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Closed sections: a one-line summary each, the rest on click

function drawer(el: Table, roadmap: Roadmap, data: PaneData, actions: PaneActions, columns: number) {
  const { Box, Button, Text } = el
  const p = progressOf(roadmap.features)
  const firstOpen = roadmap.milestones
    .map(milestone => ({ milestone, p: progressOf(roadmap.features.filter(feature => feature.milestone === milestone.id)) }))
    .find(one => (one.p.overall ?? 0) < 100)
  const story = data.previousVisit ? catchUp(roadmap, data.previousVisit, data.visitCommits.length) : null
  const week = scopeWeek(roadmap, data.nowMs)
  const summary = weeklySummary(roadmap, data.evidence, data.nowMs)

  const row = (id: string, label: string, right: unknown, body: () => unknown) => {
    const open = isOpen(`drawer:${id}`, data.open)
    return (
      <Box flexDirection="column" key={`drawer:${id}`}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1}>
          <Button key={`section:drawer:${id}`} plain onPress={() => actions.toggleSection(`drawer:${id}`)}>
            <Text {...(open ? {} : { dimColor: true })}>
              {open ? '▾' : '▸'} {label}
            </Text>
          </Button>
          {typeof right === 'string' ? <Text dimColor>{right}</Text> : (right as never)}
        </Box>
        {open ? (body() as never) : null}
      </Box>
    )
  }
  const lines = (items: readonly (string | null)[]) => (
    <Box flexDirection="column" paddingLeft={2} marginBottom={1}>
      {items
        .filter((item): item is string => item !== null && item !== '')
        .map(item => (
          <Text dimColor wrap="wrap">
            {item}
          </Text>
        ))}
    </Box>
  )

  const counted = (items: readonly string[], word: string) => (items.length > 0 ? `${items.length} ${word}` : null)
  const visitSummary = story
    ? [
        counted(story.broke, 'broke'),
        counted(story.finished, 'finished'),
        counted(story.unblocked, 'unblocked'),
        counted(story.started, 'started'),
        counted(story.blocked, 'blocked'),
        counted(story.parked, 'parked'),
      ]
        .filter(Boolean)
        .slice(0, 2)
        .join(' · ') || (story.commits > 0 ? `${story.commits} commits` : 'nothing new')
    : roadmap.where_i_left_off
      ? ago(roadmap.left_off_at, data.nowMs)
      : ''
  const list = (label: string, items: readonly string[]) => (items.length > 0 ? `${label} ${items.join(', ')}` : null)

  return (
    <Box flexDirection="column">
      {row(
        'progress',
        roadmap.milestones.length > 0 ? 'Milestones' : 'Progress',
        firstOpen ? `${firstOpen.milestone.title} ${pct(firstOpen.p.overall)}` : `UI ${pct(p.ui)} · works ${pct(p.functional)}`,
        () => (
          <Box flexDirection="column" paddingLeft={2} marginBottom={1} gap={1}>
            {roadmap.milestones.map(milestone => {
              const features = roadmap.features.filter(feature => feature.milestone === milestone.id)
              const mp = progressOf(features)
              return (
                <Box flexDirection="column" key={`milestone:${milestone.id}`}>
                  <Box flexDirection="row" justifyContent="space-between">
                    <Text>{milestone.title}</Text>
                    <Text dimColor>
                      {mp.counts.done} of {features.filter(feature => !feature.idea).length} · {pct(mp.overall)}
                    </Text>
                  </Box>
                  {bar(el, mp.overall ?? 0, ACCENT, columns - 2, `${milestone.title} ${pct(mp.overall)}`)}
                </Box>
              )
            })}
            <Text dimColor wrap="wrap">
              UI {pct(p.ui)} · works {pct(p.functional)}
              {p.ui !== null && p.functional !== null && Math.abs(p.ui - p.functional) >= GAP_ALERT
                ? p.ui > p.functional
                  ? ` · UI is ${p.ui - p.functional} points ahead of the code`
                  : ` · code is ${p.functional - p.ui} points ahead of the UI`
                : ''}
            </Text>
          </Box>
        ),
      )}
      {(story !== null || data.previousVisit !== null || roadmap.where_i_left_off !== '') &&
        row('visit', data.previousVisit ? 'Since last visit' : 'Where you left off', visitSummary, () =>
          lines([
            roadmap.where_i_left_off ? `Left off: ${roadmap.where_i_left_off}` : null,
            ...(story
              ? [
                  list('Broke:', story.broke),
                  list('Finished:', story.finished),
                  list('Unblocked:', story.unblocked),
                  list('Started:', story.started),
                  list('Newly blocked:', story.blocked),
                  list('Parked:', story.parked),
                  story.commits > 0 ? `${story.commits} commit${story.commits === 1 ? '' : 's'}` : null,
                ]
              : []),
          ]),
        )}
      {row('scope', 'Scope this week', `+${week.added.length} added · ${week.done.length} done`, () =>
        lines([
          list('Added:', week.added) ?? 'Nothing added.',
          list('Done:', week.done) ?? 'Nothing finished.',
          week.added.length - week.done.length >= 2 ? 'Adding faster than finishing.' : null,
        ]),
      )}
      {row(
        'summary',
        'Weekly summary',
        <Button key="copy-summary" plain onPress={() => actions.copySummary(summary)}>
          <Text color={ACCENT}>Copy</Text>
        </Button>,
        () => lines(summary.split('\n')),
      )}
    </Box>
  )
}

function allProjectsLink(el: Table, data: PaneData, actions: PaneActions) {
  const { Button, Text } = el
  const others = data.projects.filter(project => !project.isHere)
  if (others.length === 0) return null
  return (
    <Button key="view:all" plain onPress={() => actions.setView('all')}>
      <Text dimColor>All projects · {data.projects.length} ›</Text>
    </Button>
  )
}

// ---------------------------------------------------------------------------
// All projects

const tilde = (path: string, home: string) => (home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path)

function allProjects(el: Table, data: PaneData, actions: PaneActions) {
  const { Box, Button, Text } = el
  const columns = Math.max(24, data.columns)
  const ok = data.projects.filter(project => project.state === 'ok')
  const gone = data.projects.filter(project => project.state !== 'ok')
  const waiting = ok.reduce((sum, project) => sum + project.needsYou.length, 0)

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Button key="view:project" plain onPress={() => actions.setView('project')}>
          <Text dimColor>‹ This project</Text>
        </Button>
        <Text dimColor>
          {ok.length} {ok.length === 1 ? 'project' : 'projects'}
          {waiting > 0 ? ` · ${waiting} waiting on you` : ''}
        </Text>
      </Box>
      {ok.map(project => projectCard(el, project, data, actions, columns))}
      {gone.length > 0 && (
        <Box flexDirection="column">
          <Text dimColor>Not found</Text>
          {gone.map(project => (
            <Text dimColor wrap="wrap">
              {project.name} · {project.state === 'broken' ? 'nowhat.json has errors' : 'folder or nowhat.json gone'} · {tilde(project.path, data.home)}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  )
}

function projectCard(el: Table, project: ProjectSummary, data: PaneData, actions: PaneActions, columns: number) {
  const { Box, Button, Text } = el
  const isOpenCard = data.expandedProject === project.path
  const dot = project.health ? (HEALTH_DOT[project.health.kind] ?? { dim: true }) : { dim: true }
  const inner = Math.max(20, columns - 4)
  const quiet = project.untouchedDays >= 14
  const activity = project.untouchedDays === 0 ? 'Active today' : `Active ${ago(new Date(project.lastActiveMs).toISOString(), data.nowMs)}`

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1} key={`project:${project.path}`} {...(quiet ? { borderColor: ALERT } : { borderDimColor: true })}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1}>
        <Button key={`project:${project.path}`} plain onPress={() => actions.toggleProject(project.path)}>
          <Text bold>
            {isOpenCard ? '▾ ' : ''}
            {project.name}
          </Text>
          <Text dimColor>{project.isHere ? ' · here' : ''}</Text>
        </Button>
        <Text bold>{pct(project.overall)}</Text>
      </Box>
      {bar(el, project.overall ?? 0, ACCENT, inner, `${project.name} ${pct(project.overall)}`)}
      <Box flexDirection="row" justifyContent="space-between">
        <Text>
          <Text {...(dot.color ? { color: dot.color } : { dimColor: true })}>●</Text>
          <Text dimColor> {project.health?.label ?? ''}</Text>
        </Text>
        <Text dimColor>{project.ui === null ? `works ${pct(project.functional)}` : `UI ${pct(project.ui)} · works ${pct(project.functional)}`}</Text>
      </Box>
      {project.needsYou.length > 0 && <Text color={ALERT}>{project.needsYou.length} waiting on you</Text>}
      {project.next && (
        <Text wrap="truncate-end">
          <Text dimColor>Next: </Text>
          {project.next.title}
        </Text>
      )}
      {quiet ? (
        <Text color={ALERT} wrap="wrap">
          Untouched {project.untouchedDays} days. Pick it up or park it.
        </Text>
      ) : (
        <Text dimColor>
          {activity} · {project.done} of {project.features} done
        </Text>
      )}
      {isOpenCard && projectDetails(el, project, data, actions, inner)}
    </Box>
  )
}

/** The rest of a project's story, when its card is opened. */
function projectDetails(el: Table, project: ProjectSummary, data: PaneData, actions: PaneActions, cells: number) {
  const { Box, Button, Text } = el
  const list = (label: string, items: { title: string; reason: string }[]) =>
    items.length === 0 ? null : (
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>{label}</Text>
        {items.map(item => (
          <Text wrap="wrap">
            <Text>{item.title}</Text>
            <Text dimColor>{item.reason ? ` · ${item.reason}` : ''}</Text>
          </Text>
        ))}
      </Box>
    )

  return (
    <Box flexDirection="column" paddingLeft={1}>
      {project.leftOff && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Left off</Text>
          <Text wrap="wrap">{project.leftOff}</Text>
        </Box>
      )}
      {project.next && project.next.note && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Next up · {STATUS_WORDS[project.next.status]}</Text>
          <Text wrap="wrap">{project.next.note}</Text>
        </Box>
      )}
      {list('Needs you', project.needsYou)}
      {list('Needs code', project.needsCode)}
      {project.milestones.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {project.milestones.map(milestone => (
            <Box flexDirection="column">
              <Box flexDirection="row" justifyContent="space-between">
                <Text>{milestone.title}</Text>
                <Text dimColor>
                  {milestone.done} of {milestone.total} · {pct(milestone.overall)}
                </Text>
              </Box>
              {bar(el, milestone.overall ?? 0, ACCENT, cells - 2, `${milestone.title} ${pct(milestone.overall)}`)}
            </Box>
          ))}
        </Box>
      )}
      {project.live !== null && (
        <Box marginTop={1}>
          <Text dimColor>Deployed app: {project.live ? 'answering' : 'not answering'}</Text>
        </Box>
      )}
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor wrap="wrap">
          {tilde(project.path, data.home)}
        </Text>
        {!project.isHere && (
          <Button key={`copy:${project.path}`} plain onPress={() => actions.copyPath(project.path)}>
            <Text color={ACCENT}>Copy path</Text>
          </Button>
        )}
      </Box>
    </Box>
  )
}
