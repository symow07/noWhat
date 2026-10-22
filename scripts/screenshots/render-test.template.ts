// The screenshot states, drawn by the real sidebar in the engine's test kit.
// render.mjs fills in the data below and runs this from a throwaway copy of the plugin.

import { test } from 'claude-code/testing'

import { FILE, REGISTRY, ROOT, world } from './world'

type Project = { path: string; data: { name: string; project_id: string } }
const DATA = __DATA__ as { demo: unknown; evidence: unknown; companions: Project[] }

test('screenshots', async ($, on) => {
  const w = world(on)
  w.files.set(FILE, { text: JSON.stringify(DATA.demo), mtimeMs: 1 })
  w.files.set(`${ROOT}/.claude/nowhat/evidence.json`, { text: JSON.stringify(DATA.evidence), mtimeMs: 1 })
  for (const project of DATA.companions) w.files.set(`${project.path}/.claude/nowhat.json`, { text: JSON.stringify(project.data), mtimeMs: 1 })
  const projects = [
    { path: ROOT, name: 'Acme Notes', added_at: '2026-01-01T00:00:00.000Z', project_id: 'demo-acme-notes' },
    ...DATA.companions.map(project => ({ path: project.path, name: project.data.name, added_at: '2026-01-01T00:00:00.000Z', project_id: project.data.project_id })),
  ]
  w.files.set(REGISTRY, { text: JSON.stringify({ version: 1, projects }), mtimeMs: 1 })

  await $.session.start({ cwd: ROOT, surface: null, isInteractive: false })
  const props = { title: 'noWhat', isFocused: false, bodyColumns: 46, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 400 }, view: {} }
  const ui = await $.ui.mount({ plugin: 'nowhat', surface: 'desktop', component: 'Pane', requestId: 'nowhat', props })
  const shots: Record<string, unknown> = {}
  shots.overview = await ui.drawn()
  await ui.press({ key: 'tab:needs' })
  shots.needs = await ui.drawn()
  await ui.press({ key: 'tab:decisions' })
  shots.decisions = await ui.drawn()
  await ui.press({ key: 'tab:launch' })
  shots.launch = await ui.drawn()
  await ui.press({ key: 'tab:features' })
  await ui.press({ key: 'view:all' })
  shots.projects = await ui.drawn()
  console.log(`@@SHOTS${JSON.stringify(shots)}`)
})
