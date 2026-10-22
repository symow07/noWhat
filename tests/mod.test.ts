import { expect, test } from 'claude-code/testing'

import { COMPOSER, FEATURES, FILE, REGISTRY, ROOT, editFile, nowhat, setUp, world } from './world'

/** The test runtime has timers; its types (no DOM, no Node) don't name them. */
declare const setTimeout: (callback: () => void, ms: number) => unknown

test('setup saves the features and registers the project', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: false })

  const saved = await setUp($, { name: 'Sample', where_i_left_off: 'Charts done.', features: FEATURES })
  expect(saved.text ?? (saved as { result?: unknown }).result).toContain('Saved 3 features')
  expect(w.roadmap()).toMatchObject({ name: 'Sample', where_i_left_off: 'Charts done.' })
  expect(w.roadmap().features[0].last_conversation).toMatchObject({ session_id: 'session-1', title: 'Wire up the login screen' })
  // The file gets a project id, and the registry knows the project by it.
  const id = w.roadmap().project_id
  expect(typeof id).toBe('string')
  expect(JSON.parse(w.files.get(REGISTRY)?.text ?? '{}').projects).toEqual([
    { path: ROOT, name: 'Sample', added_at: '2026-10-12T20:00:00.000Z', project_id: id },
  ])

  const again = await $.tool.call({ tool: 'mcp__nowhat__setup', tool_use_id: 't2', name: 'Sample', features: [] })
  expect(again.deny).toContain('already exists')
})

test('setup refuses "working" that nobody confirmed', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: false })
  const unproven = FEATURES.map(feature => (feature.id === 'charts' ? { ...feature, verified_by: undefined } : feature))
  const refused = await setUp($, { name: 'Sample', features: unproven })
  expect(refused.deny).toContain('working needs verified_by')
  expect(w.files.has(FILE)).toBe(false)
})

test('edits go to the feature last put in progress, and nowhere once it is done', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: false })
  await setUp($, { name: 'Sample', features: FEATURES })

  await $.tool.call(editFile(`${ROOT}/src/early.ts`))
  await $.tool.call({ tool: 'mcp__nowhat__update', tool_use_id: 't2', changes: [{ id: 'login', status: 'in_progress' }] })
  await $.tool.call(editFile(`${ROOT}/src/login.tsx`))
  await $.tool.call(editFile(`${ROOT}/src/auth.ts`))
  await $.tool.call(editFile(`${ROOT}/.claude/settings.json`))
  expect(w.roadmap().features[0].related_files).toEqual(['src/login.tsx', 'src/auth.ts'])

  await $.tool.call({ tool: 'mcp__nowhat__update', tool_use_id: 't3', changes: [{ id: 'login', status: 'done' }] })
  await $.tool.call(editFile(`${ROOT}/src/later.ts`))
  expect(w.roadmap().features[0].related_files).toEqual(['src/login.tsx', 'src/auth.ts'])

  // The unassigned edits reach Claude with the next sort, for it to file.
  const facts = await $.tool.call({ tool: 'mcp__nowhat__context', tool_use_id: 't4', purpose: 'sort' })
  expect((facts as { result?: string }).result).toContain('- src/early.ts\n- src/later.ts')
})

test('a bad update saves nothing and says why', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: false })
  await setUp($, { name: 'Sample', features: FEATURES })
  const before = w.files.get(FILE)?.text

  const refused = await $.tool.call({
    tool: 'mcp__nowhat__update',
    tool_use_id: 't2',
    changes: [{ id: 'login', status: 'blocked' }],
  })
  expect(refused.deny).toContain('blocker_reason')
  expect(w.files.get(FILE)?.text).toBe(before)
})

test('changes made outside Claude are logged at no cost', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: false })
  await setUp($, { name: 'Sample', features: FEATURES })

  w.editOutside(json => {
    const login = json.features.find(feature => feature.id === 'login')
    if (login) login.status = 'in_progress'
  })
  // The next prompt notices the edit, logs it, and tells Claude where things stand now.
  await $.prompt.submit({ text: 'carry on', wait: false, origin: COMPOSER })
  expect(w.roadmap().recent_changes[0]).toMatchObject({ id: 'login', field: 'status', source: 'outside' })
  expect(w.submitted[0]?.context[0]).toContain('In progress: login.')

  // /nowhat opens the sidebar and prints nothing: no tokens.
  const shown = await nowhat($)
  expect(shown).toEqual({})
})

test('/nowhat toggles once set up: it hides the sidebar when it shows, and brings it forward when it is a tab behind another', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: false })
  await setUp($, { name: 'Sample', features: FEATURES })
  w.panes.push({ id: 'nowhat', title: 'noWhat', isShown: true, isPlaced: true })
  await nowhat($)
  expect(w.closed).toEqual(['nowhat'])
  w.panes[0] = { id: 'nowhat', title: 'noWhat', isShown: false, isPlaced: true }
  await nowhat($)
  expect(w.closed).toEqual(['nowhat'])
})

test('the status line rides along with a prompt only when it changed', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: false })
  await $.prompt.submit({ text: 'not set up yet', wait: false, origin: COMPOSER })
  await setUp($, { name: 'Sample', features: FEATURES })
  await $.prompt.submit({ text: 'first', wait: false, origin: COMPOSER })
  await $.prompt.submit({ text: 'second', wait: false, origin: COMPOSER })

  expect(w.submitted.map(prompt => prompt.context.length)).toEqual([0, 1, 0])
  expect(w.submitted[1]?.context[0]).toContain('noWhat (.claude/nowhat.json)')
  expect(w.submitted[1]?.context[0]).toContain('Blocked: sync (needs the user: Stripe keys).')
})

test('only /nowhat sets a project up: Claude cannot on its own, and each step gets its instructions', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: false })

  // Without the person's /nowhat, setup is refused and nothing is written or registered.
  const unasked = await $.tool.call({ tool: 'mcp__nowhat__setup', tool_use_id: 't0', name: 'Sample', features: FEATURES } as never)
  expect(unasked.deny).toContain("hasn't run /nowhat")
  const peek = await $.tool.call({ tool: 'mcp__nowhat__context', tool_use_id: 't1', purpose: 'setup' })
  expect(peek.deny).toContain("hasn't run /nowhat")
  expect(w.files.has(FILE)).toBe(false)
  expect(w.files.has(REGISTRY)).toBe(false)

  // /nowhat with nothing set up: setup starts, with its instructions and the inventory.
  const started = await nowhat($)
  expect(started.text).toBe('noWhat: setting up. Claude groups the code into features.')
  const setup = await $.tool.call({ tool: 'mcp__nowhat__context', tool_use_id: 't2', purpose: 'setup' })
  expect((setup as { result?: string }).result).toMatch(/^prompt:setup\n\n/)
  expect((setup as { result?: string }).result).toContain(`Project: sample-app, at ${ROOT}.`)
  expect((setup as { result?: string }).result).toContain('Planning docs: PLAN.md.')

  await $.tool.call({ tool: 'mcp__nowhat__setup', tool_use_id: 't3', name: 'Sample', features: FEATURES } as never)
  const sort = await $.tool.call({ tool: 'mcp__nowhat__context', tool_use_id: 't5', purpose: 'sort' })
  expect((sort as { result?: string }).result).toMatch(/^prompt:sort\n\n/)
  expect((sort as { result?: string }).result).toContain('sync · blocked · logic · works none · Payments')
  expect((sort as { result?: string }).result).toContain('Unsorted files: none.')
  const next = await $.tool.call({ tool: 'mcp__nowhat__context', tool_use_id: 't6', purpose: 'next' })
  expect((next as { result?: string }).result).toMatch(/^prompt:next\n\nNext up: /)
})

test('/nowhat starts setup as soon as its own turn ends, once', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: false })
  await nowhat($)
  expect(w.submitted).toEqual([])
  const done = { answer: '', durationMs: 1, isAborted: false, turnId: 'turn-1', reason: 'answer' as const }
  await $.turn.complete(done)
  // The prompt goes out without holding the turn's end: wait for it to land.
  for (let tries = 0; tries < 50 && w.submitted.length === 0; tries += 1) await new Promise<void>(resolve => setTimeout(() => resolve(), 10))
  await $.turn.complete({ ...done, turnId: 'turn-2' })
  await new Promise<void>(resolve => setTimeout(() => resolve(), 50))
  expect(w.submitted.map(prompt => prompt.text)).toEqual(['Set up noWhat for this project: call mcp__nowhat__context with purpose setup and follow its instructions.'])
})

test('a project is registered only where /nowhat runs, and a moved one replaces its entry only by its exact id', async ($, on) => {
  const w = world(on)
  // The file carries its id; the registry lists it at its old path (gone), and an older entry with the same name but no id.
  w.files.set(FILE, {
    text: JSON.stringify({ schema_version: 2, project_id: 'p-1', name: 'Sample', features: [{ id: 'a', title: 'A', status: 'queued' }] }),
    mtimeMs: 1,
  })
  const before = {
    version: 1,
    projects: [
      { path: '/old/sample-app', name: 'Sample', added_at: '2026-01-01T00:00:00.000Z', project_id: 'p-1' },
      { path: '/old/other', name: 'Sample', added_at: '2026-02-01T00:00:00.000Z' },
    ],
  }
  w.files.set(REGISTRY, { text: JSON.stringify(before), mtimeMs: 1 })
  // Opening a session registers nothing.
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: false })
  expect(JSON.parse(w.files.get(REGISTRY)?.text ?? '{}')).toEqual(before)
  // /nowhat does: the same id replaces its old entry; the same name alone is never taken as the same project.
  await nowhat($)
  expect(JSON.parse(w.files.get(REGISTRY)?.text ?? '{}').projects).toEqual([
    { path: '/old/other', name: 'Sample', added_at: '2026-02-01T00:00:00.000Z' },
    { path: ROOT, name: 'Sample', added_at: '2026-01-01T00:00:00.000Z', project_id: 'p-1' },
  ])
})

test('editing a file under the active feature counts this session on it, once', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: false })
  await setUp($, { name: 'Sample', features: FEATURES })
  await $.tool.call({ tool: 'mcp__nowhat__update', tool_use_id: 'u1', changes: [{ id: 'login', status: 'in_progress' }] })
  await $.tool.call(editFile(`${ROOT}/src/login.tsx`))
  await $.tool.call(editFile(`${ROOT}/src/login.tsx`))
  const login = (w.roadmap().features as { id: string; sessions?: { id: string }[] }[]).find(feature => feature.id === 'login')
  expect(login?.sessions).toEqual([expect.objectContaining({ id: 'session-1' })])
})

test("a features file someone else committed switches nothing on: noWhat stays off until /nowhat", async ($, on) => {
  const w = world(on)
  w.files.set(FILE, { text: JSON.stringify({ schema_version: 2, name: 'Cloned', features: [{ id: 'a', title: 'A', status: 'queued' }] }), mtimeMs: 1 })
  await $.session.start({ cwd: ROOT, surface: null, isInteractive: false })
  // No sidebar, no rules, no status line, no tools that act, no evidence written.
  expect(w.opened).toEqual([])
  await $.prompt.submit({ text: 'hello', wait: false, origin: COMPOSER })
  expect(w.submitted[0]?.context).toEqual([])
  const refused = await $.tool.call({ tool: 'mcp__nowhat__update', tool_use_id: 'u1', changes: [{ id: 'a', status: 'done' }] })
  expect(refused.deny).toContain('noWhat is off in this project')
  const detected = await $.tool.call({ tool: 'mcp__nowhat__detect', tool_use_id: 'd1' })
  expect((detected as { result?: string }).result).toContain('noWhat is off in this project')
  expect(w.files.has(`${ROOT}/.claude/nowhat/evidence.json`)).toBe(false)
  // The person runs /nowhat: now it's on here.
  await nowhat($)
  expect(w.opened).toEqual(['nowhat'])
  expect(JSON.parse(w.files.get(REGISTRY)?.text ?? '{}').projects.map((entry: { path: string }) => entry.path)).toEqual([ROOT])
})
