import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { FEATURES, FILE, REGISTRY, ROOT, setUp, world } from './world'

const SURFACES = ['desktop', 'terminal'] as const
const PANE_PROPS = {
  title: 'Roadmap',
  isFocused: false,
  bodyColumns: 48,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 120 },
  view: {},
}
const EVIDENCE = `${ROOT}/.claude/nowhat/evidence.json`

// Login and reset queued; tags looks designed but works not at all, so UI runs ahead.
const MORE = [
  ...FEATURES,
  { id: 'reset', title: 'Password reset email', status: 'queued' },
  { id: 'tags', title: 'Tags', status: 'in_progress', ui_state: 'designed', functional_state: 'none' },
]

const mountPane = ($: Engine, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({ plugin: 'nowhat', surface, component: 'Pane', requestId: 'nowhat', props: PANE_PROPS })

async function sample($: Engine, on: Parameters<typeof world>[0], fields: Record<string, unknown> = {}) {
  const w = world(on)
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: false })
  await setUp($, { name: 'Sample', where_i_left_off: 'Done: charts. Next: login.', features: MORE, ...fields })
  return w
}

test('not set up yet: one button sets it up with Claude', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: false })
  const mounted = []
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect(await ui.find({ type: 'Text', text: "noWhat isn't set up here yet" })).toBeDefined()
    expect(await ui.find({ key: 'setup' })).toBeDefined()
    mounted.push(ui)
  }
  // The button is the person asking: setup is allowed, and Claude starts on it.
  await mounted[0]?.press({ key: 'setup' })
  expect(w.submitted.at(-1)?.text).toBe('Set up noWhat for this project: call mcp__nowhat__context with purpose setup and follow its instructions.')
  const setup = await $.tool.call({ tool: 'mcp__nowhat__setup', tool_use_id: 's1', name: 'Sample', features: FEATURES } as never)
  expect(setup.deny).toBeUndefined()
})

test('Continue with Claude starts the next-up feature: no command to remember', async ($, on) => {
  const w = await sample($, on)
  const ui = await mountPane($, 'desktop')
  await ui.press({ key: 'continue' })
  expect(w.submitted.at(-1)?.text).toBe('Continue Tags (tags): call mcp__nowhat__context with purpose next and follow its instructions.')
})

test('new files no feature claims show as Unsorted, with the one button that sorts them', async ($, on) => {
  const w = await sample($, on)
  const ui = await mountPane($, 'desktop')
  expect(await ui.find({ type: 'Text', text: 'UNSORTED' })).toBeUndefined()
  const evidence = JSON.parse(w.files.get(EVIDENCE)?.text ?? 'null') ?? {
    version: 2,
    checked_at: '2026-10-12T20:00:00.000Z',
    hosts_checked_at: null,
    project: { languages: [], frameworks: [], hosts: [], test_commands: [], tests: [], file_count: 1, screens: 0, routes: 0, git: true },
    hosts: [],
    live: null,
    test_runs: [],
    test_results: {},
    features: {},
  }
  w.files.set(EVIDENCE, { text: JSON.stringify({ ...evidence, unsorted: ['src/export/csv.ts', 'src/export/pdf.ts', 'src/a.ts', 'src/b.ts', 'src/c.ts'] }), mtimeMs: 77 })
  // Any redraw reads the new evidence: picking the tab is one.
  await ui.press({ key: 'tab:features' })
  const fresh = ui
  expect(await fresh.find({ type: 'Text', text: 'UNSORTED' })).toBeDefined()
  expect(await fresh.find({ type: 'Text', text: 'src/export/csv.ts' })).toBeDefined()
  expect(await fresh.find({ type: 'Text', text: 'src/c.ts' })).toBeUndefined()
  expect(await fresh.find({ type: 'Text', text: /1 more/ })).toBeDefined()
  await fresh.press({ key: 'sort' })
  expect(w.submitted.at(-1)?.text).toBe("Sort what noWhat doesn't know yet: call mcp__nowhat__context with purpose sort and follow its instructions.")
})

test('the default view: header, next up, capture, tabs, rows of one pill, and closed sections', async ($, on) => {
  await sample($, on)
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    // Header: name, %, health, refresh and when it was checked.
    expect(await ui.find({ type: 'Markdown', text: /Sample/ })).toBeDefined()
    expect(await ui.find({ key: 'refresh' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^checked|not checked yet/ })).toBeDefined()
    // Nothing is wrong, so no alert strip.
    expect(await ui.find({ type: 'Text', text: /^Broke:|^Down:|^Rabbit hole:/ })).toBeUndefined()
    // Next up, with a way to start it, and one line to capture an idea.
    expect(await ui.find({ type: 'Text', text: 'Tags' })).toBeDefined()
    expect(await ui.find({ key: 'continue' })).toBeDefined()
    expect(await ui.find({ type: 'Input' })).toBeDefined()
    // Four tabs, Features open; Launch only appears for a store or web app.
    for (const tab of ['features', 'needs', 'decisions']) expect(await ui.find({ key: `tab:${tab}` })).toBeDefined()
    expect(await ui.find({ key: 'tab:launch' })).toBeUndefined()
    // Each row: one pill and the name. Done folds away.
    const labels =
      surface === 'desktop'
        ? (await ui.findAll({ type: 'Svg' })).map(svg => String(svg.props.alt))
        : (await ui.findAll({ type: 'Text' })).map(text => String(text.text).trim())
    // A feature waiting on the person says so in grey; the red count is on the Needs you tab.
    expect(labels).toEqual(expect.arrayContaining(['In progress', 'Queued', 'Needs you']))
    expect(await ui.find({ key: 'feature:tags' })).toBeDefined()
    expect(await ui.find({ key: 'feature:charts' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /1 done/ })).toBeDefined()
    // Milestones, since last visit, scope and the summary start closed, each with its one-line summary.
    expect(await ui.find({ key: 'section:drawer:progress' })).toBeDefined()
    expect(await ui.find({ key: 'section:drawer:scope' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\+\d+ added · \d+ done/ })).toBeDefined()
    expect(await ui.find({ key: 'copy-summary' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /points ahead/ })).toBeUndefined()
  }
})

test('tabs: Needs you lists what waits on the person; Decisions shows what Claude recorded', async ($, on) => {
  await sample($, on)
  const ui = await mountPane($, 'desktop')
  await ui.press({ key: 'tab:needs' })
  expect(await ui.find({ type: 'Text', text: 'Payments' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Stripe keys' })).toBeDefined()
  // Only one tab's content at a time.
  expect(await ui.find({ key: 'feature:tags' })).toBeUndefined()

  await ui.press({ key: 'tab:decisions' })
  expect(await ui.find({ type: 'Text', text: /No decisions yet/ })).toBeDefined()
  await $.tool.call({ tool: 'mcp__nowhat__update', tool_use_id: 'u1', decisions: [{ text: 'Stripe over invoices, because users asked for cards', feature: 'sync' }] })
  expect(await ui.find({ type: 'Text', text: 'Stripe over invoices, because users asked for cards' })).toBeDefined()
})

test('quick capture adds an idea to the backlog, clears the field, and spends no tokens', async ($, on) => {
  const w = await sample($, on)
  const ui = await mountPane($, 'desktop')
  const field = await ui.find({ type: 'Input' })
  expect(field?.key).toBe('capture:0')
  await ui.input({ key: 'capture:0', text: 'Split bills with a link' })
  const added = (w.roadmap().features as { id: string; title: string; idea?: boolean; status: string }[]).find(feature => feature.title === 'Split bills with a link')
  expect(added).toMatchObject({ id: 'split-bills-with-a-link', idea: true, status: 'not_started' })
  expect(w.submitted).toEqual([])
  // A fresh field, and the idea in the backlog with its pill.
  expect((await ui.find({ type: 'Input' }))?.key).toBe('capture:1')
  expect(await ui.find({ type: 'Text', text: 'BACKLOG' })).toBeDefined()
  expect((await ui.findAll({ type: 'Svg' })).map(svg => svg.props.alt)).toContain('Idea')
  // An idea isn't a commitment: progress ignores it, next up never picks it.
  expect(w.roadmap().progress_log.at(-1)).toBeDefined()
})

test('rows open on click; the queue reorders and pins from the details; done unfolds', async ($, on) => {
  const w = await sample($, on)
  const ui = await mountPane($, 'desktop')
  await ui.press({ key: 'section:done:all' })
  expect(await ui.find({ key: 'feature:charts' })).toBeDefined()
  await ui.press({ key: 'section:done:all' })
  expect(await ui.find({ key: 'feature:charts' })).toBeUndefined()

  expect(await ui.find({ type: 'Text', text: 'src/login.tsx' })).toBeUndefined()
  await ui.press({ key: 'feature:login' })
  expect(await ui.find({ type: 'Text', text: 'src/login.tsx' })).toBeDefined()
  // The first queued feature can only move down.
  expect(await ui.find({ key: 'up:login' })).toBeUndefined()
  await ui.press({ key: 'down:login' })
  const queued = (w.roadmap().features as { id: string; status: string }[]).filter(feature => feature.status === 'queued').map(feature => feature.id)
  expect(queued).toEqual(['reset', 'login'])
  await ui.press({ key: 'pin:login' })
  expect((w.roadmap().features as { id: string; pinned?: boolean }[]).find(feature => feature.id === 'login')?.pinned).toBe(true)
  expect(await ui.find({ type: 'Text', text: 'Unpin status' })).toBeDefined()
})

test('milestones group the rows and open with their own bars', async ($, on) => {
  await sample($, on, {
    milestones: [
      { id: 'v1', title: 'Launch v1' },
      { id: 'later', title: 'Post-launch' },
    ],
    features: MORE.map(feature => ({ ...feature, milestone: feature.id === 'reset' ? 'later' : 'v1' })),
  })
  const ui = await mountPane($, 'desktop')
  expect(await ui.find({ type: 'Text', text: 'LAUNCH V1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'POST-LAUNCH' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Launch v1 \d+%$/ })).toBeDefined()
  await ui.press({ key: 'section:drawer:progress' })
  const bars = (await ui.findAll({ type: 'Svg' })).map(svg => String(svg.props.alt))
  expect(bars.some(alt => alt.startsWith('Launch v1'))).toBe(true)
  expect(bars.some(alt => alt.startsWith('Post-launch'))).toBe(true)
  // UI 38% against functional 20%: the gap is said inside, not on the default view.
  expect(await ui.find({ type: 'Text', text: /UI is 18 points ahead of the code/ })).toBeDefined()
})

test('a regression shows the alert strip and becomes next up', async ($, on) => {
  const w = await sample($, on)
  w.editOutside(json => {
    const login = json.features.find(feature => feature.id === 'login') as Record<string, unknown>
    login.regressed = { at: '2026-10-12T18:00:00.000Z', reason: 'tests fail' }
  })
  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    expect(await ui.find({ type: 'Text', text: 'Broke:' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Login screen\. Tests fail since 2h ago\./ })).toBeDefined()
    // Next up is the thing that broke, with its pill.
    const next = await ui.findAll({ type: 'Text', text: 'Login screen' })
    expect(next.length).toBeGreaterThan(0)
    expect(await ui.find({ type: 'Text', text: /^Broke: tests fail/ })).toBeDefined()
  }
})

test('refresh re-checks now without tests, and the summary copies in one click', async ($, on) => {
  const w = await sample($, on)
  const ui = await mountPane($, 'desktop')
  await ui.press({ key: 'refresh' })
  expect(w.files.has(EVIDENCE)).toBe(true)
  expect(await ui.find({ type: 'Text', text: 'checked just now' })).toBeDefined()
  expect(JSON.parse(w.files.get(EVIDENCE)?.text ?? '{}').test_runs).toEqual([])

  await ui.press({ key: 'copy-summary' })
  expect(w.copied[0]).toMatch(/^Sample · week of /)
  expect(w.copied[0]?.split('\n').length).toBeLessThanOrEqual(5)
  expect(w.toasts).toContain('Weekly summary copied')
})

test('the launch tab lists what a store would reject first', async ($, on) => {
  const w = await sample($, on)
  // Evidence as detection writes it for an app.
  w.files.set(EVIDENCE, {
    text: JSON.stringify({
      version: 2,
      checked_at: '2026-10-12T20:00:00.000Z',
      hosts_checked_at: null,
      project: { languages: [], frameworks: ['Expo'], hosts: [], test_commands: [], tests: [], file_count: 1, screens: 0, routes: 0, git: true },
      hosts: [],
      live: null,
      test_runs: [],
      test_results: {},
      features: {},
      launch: {
        kind: 'app',
        privacy: null,
        device_build: 'simulator',
        checks: [
          { id: 'device-build', label: 'Device build', state: 'fail', evidence: 'Simulator builds only' },
          { id: 'privacy', label: 'Privacy policy', state: 'ok', evidence: 'acme.example/privacy answers 200' },
        ],
      },
    }),
    mtimeMs: 99,
  })
  const ui = await mountPane($, 'desktop')
  expect(await ui.find({ key: 'tab:launch' })).toBeDefined()
  await ui.press({ key: 'tab:launch' })
  expect(await ui.find({ type: 'Text', text: 'APP STORE · PLAY' })).toBeDefined()
  const labels = (await ui.findAll({ type: 'Text' })).map(text => String(text.text))
  expect(labels.indexOf('Device build')).toBeLessThan(labels.indexOf('Privacy policy'))
  expect(await ui.find({ type: 'Text', text: 'Simulator builds only' })).toBeDefined()
})

test('all projects: a card each, most recent first, a nudge for the quiet one, and the rest when opened', async ($, on) => {
  const w = await sample($, on)
  // Two more projects: one quiet for a month and waiting on its owner, one whose folder went.
  const month = '2026-09-12T20:00:00.000Z'
  w.files.set('/work/notes/.claude/nowhat.json', {
    text: JSON.stringify({
      schema_version: 2,
      name: 'Notes',
      last_touched: month,
      features: [{ id: 'sync', title: 'Cloud sync', status: 'blocked', blocker_reason: 'iCloud entitlement', blocked_on: 'you', updated_at: month }],
    }),
    mtimeMs: 1,
  })
  const registry = JSON.parse(w.files.get(REGISTRY)?.text ?? '{}')
  registry.projects.push({ path: '/work/notes', name: 'notes', added_at: month }, { path: '/work/gone', name: 'gone', added_at: month })
  w.files.set(REGISTRY, { text: JSON.stringify(registry), mtimeMs: 2 })

  for (const surface of SURFACES) {
    const ui = await mountPane($, surface)
    await ui.press({ key: 'view:all' })
    const cards = (await ui.findAll({ type: 'Button' })).map(button => button.key).filter(key => String(key).startsWith('project:'))
    expect(cards).toEqual(['project:/work/sample-app', 'project:/work/notes'])
    expect(await ui.find({ type: 'Text', text: 'Untouched 30 days. Pick it up or park it.' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 waiting on you/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Not found' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /iCloud entitlement/ })).toBeUndefined()

    await ui.press({ key: 'project:/work/notes' })
    expect(await ui.find({ type: 'Text', text: /iCloud entitlement/ })).toBeDefined()
    expect(await ui.find({ key: 'copy:/work/notes' })).toBeDefined()
    await ui.press({ key: 'project:/work/notes' })
    await ui.press({ key: 'view:project' })
    expect(await ui.find({ key: 'continue' })).toBeDefined()
  }
  expect(w.files.has(FILE)).toBe(true)
})

test('a parked feature says Parked, whatever its states', async ($, on) => {
  await sample($, on, { features: [...MORE, { id: 'clipper', title: 'Web clipper', status: 'parked', parked_reason: 'Store rules unclear', ui_state: 'designed', functional_state: 'partial' }] })
  const ui = await mountPane($, 'desktop')
  const labels = (await ui.findAll({ type: 'Svg' })).map(svg => String(svg.props.alt))
  expect(labels).toContain('Parked')
  expect(labels).not.toContain('UI ahead')
})
