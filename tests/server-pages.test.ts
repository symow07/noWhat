import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { SERVER_APP, SERVER_FEATURES, SERVER_MILESTONES, serverRepo } from './fixtures/server-pages'
import { ROOT, setUp, world } from './world'

// A server that renders its own pages, checked end to end through the plugin:
// its screens are .ts route modules, its integration tests call URLs, its whole
// suite is green and it has never been deployed.

const NOW_MS = Date.parse('2026-10-12T20:00:00Z')
const EVIDENCE = `${ROOT}/.claude/nowhat/evidence.json`
const PANE_PROPS = {
  title: 'noWhat',
  isFocused: false,
  bodyColumns: 48,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 200 },
  view: {},
}

type Saved = { id: string; status: string; ui_state?: string; functional_state: string; verified_by: string | null; status_by?: string }

async function plotline($: Engine, on: Parameters<typeof world>[0]) {
  const w = world(on, { files: SERVER_APP, run: serverRepo(NOW_MS) })
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: false })
  await setUp($, { name: 'Plotline', features: SERVER_FEATURES, milestones: SERVER_MILESTONES })
  // What setup asks Claude to do next: a check with the test suites.
  await $.tool.call({ tool: 'mcp__nowhat__detect', tool_use_id: 'detect', tests: true } as never)
  const evidence = JSON.parse(w.files.get(EVIDENCE)?.text ?? 'null')
  const features = w.roadmap().features as Saved[]
  return { w, evidence, byId: new Map(features.map(feature => [feature.id, feature])) }
}

test('its pages are screens: the UI style is read first, then pages by what they contain', async ($, on) => {
  const { w, evidence, byId } = await plotline($, on)
  expect(evidence.project.ui_style).toBe('server')
  // Twelve page modules, the layout, and the app that answers text/html.
  expect(evidence.project.pages).toBe(14)
  // Screens come from the routes: twelve pages and one booking's page; /health and the POST aren't screens.
  expect(evidence.project.screens).toBe(13)
  for (const id of ['plots', 'bookings', 'reports', 'sign-in']) expect(byId.get(id)?.ui_state).toBe('designed')
  // Wiring came from one read of the files, never a git grep -w that can time out.
  expect(w.ran.some(argv => argv[0] === 'git' && argv[1] === 'grep' && argv.includes('-w'))).toBe(false)
  expect(evidence.project.scan.complete).toBe(true)
})

test('integration tests map through the routes they call; the rest are counted', async ($, on) => {
  const { evidence } = await plotline($, on)
  const testsOf = (id: string) => evidence.features[id].tests as string[]
  expect(testsOf('bookings')).toContain('tests/integration/bookings.test.ts')
  expect(testsOf('waitlist')).toEqual(['tests/integration/members.test.ts'])
  expect(testsOf('calendar')).toEqual(['tests/integration/calendar.test.ts'])
  expect(testsOf('sign-in')).toEqual(['tests/integration/auth.test.ts'])
  expect(testsOf('plots')).toEqual(['tests/unit/plots.test.ts'])
  expect(testsOf('reports')).toEqual([])
  // The health check reaches no feature's code, and a helper is no feature's test.
  expect(evidence.project.unmapped_tests).toBe(2)
  expect(evidence.project.unmapped_sample.sort()).toEqual(['tests/helpers/fake-store.ts', 'tests/integration/smoke.test.ts'])
})

test('built is done, not in progress: tested ones by their tests, the rest by the green suite', async ($, on) => {
  const { byId } = await plotline($, on)
  for (const id of ['plots', 'bookings', 'members', 'waitlist', 'invoices', 'calendar', 'sign-in']) {
    expect(byId.get(id)).toMatchObject({ status: 'done', functional_state: 'working', verified_by: 'tests', status_by: 'detected' })
  }
  // No test maps to these, and the whole suite passes: built, tests not mapped.
  for (const id of ['reports', 'notices']) expect(byId.get(id)).toMatchObject({ status: 'done', functional_state: 'working', verified_by: 'suite' })
  // What Claude recorded stands.
  expect(byId.get('go-live')).toMatchObject({ status: 'blocked', status_by: 'claude' })
})

test('the sidebar agrees with itself: built and live, needs you, milestones, merged work', async ($, on) => {
  const { w } = await plotline($, on)
  const ui = await $.ui.mount({ plugin: 'nowhat', surface: 'desktop', component: 'Pane', requestId: 'nowhat', props: PANE_PROPS })
  // 9 of 11 built; a deploy host but no deploy seen: live is unknown, not 0%.
  expect(await ui.find({ type: 'Text', text: '82%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /live unknown/ })).toBeDefined()
  // Two things wait on the person: never "Thriving".
  expect(await ui.find({ type: 'Text', text: /2 waiting on you/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Thriving/ })).toBeUndefined()

  await ui.press({ key: 'section:done:m:season-2' })
  expect((await ui.findAll({ type: 'Svg' })).map(svg => svg.props.alt)).toContain('Built')

  await ui.press({ key: 'section:drawer:progress' })
  // The count and the percentage are one measure.
  expect(await ui.find({ type: 'Text', text: '4 of 4 built · 100%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '0 of 2 built · 0%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /2 map to no feature/ })).toBeDefined()

  await ui.press({ key: 'copy-summary' })
  expect(w.copied[0]).toMatch(/Done: .+; 2 PRs merged \(#41–#42\)\./)
  // Host checks were never switched on: nothing reached the network.
  expect(w.fetched).toEqual([])
})
