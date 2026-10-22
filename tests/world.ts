// A project on disk in memory for the tests: no git, a fake HOME, and a record of prompts.

import { mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

export const ROOT = '/work/sample-app'
export const FILE = `${ROOT}/.claude/nowhat.json`
export const REGISTRY = '/home/me/.claude/nowhat-projects.json'
export const COMPOSER = { kind: 'composer' } as const
export const PRESENTATION = { isFullscreen: false, columns: 100 }

type Stored = { text: string; mtimeMs: number }

/** A project on disk in memory, no git, and a record of the prompts the mod submits. */
export function world(on: On) {
  const files = new Map<string, Stored>()
  /** Set by breakDisk(): every file call fails, as a full or unreadable disk would. */
  let broken = false
  const disk = () => {
    if (broken) throw new Error('disk failure')
  }
  const submitted: { text: string; context: readonly string[] }[] = []
  /** The panes the surface has open, and the ids closed through $.ui.close. */
  const panes: { id: string; title: string; isShown: boolean; isPlaced: boolean; isFocused?: boolean }[] = []
  const closed: string[] = []
  /** What the mod put on the clipboard, and the toasts it showed. */
  const copied: string[] = []
  /** The panes the mod opened. */
  const opened: string[] = []
  /** Every process the mod started (argv), and every URL it fetched. */
  const ran: string[][] = []
  const fetched: string[] = []
  /** The project's top-level files, as listing it shows them. */
  const listing = ['PLAN.md']
  const toasts: string[] = []
  let tick = 1

  mock.store(on)
  mock.clock(on, { now: Date.parse('2026-10-12T20:00:00Z') })
  mock.env(on, { HOME: '/home/me' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'Wire up the login screen', toolUses: [] }] }))
  on('process.run', ($, e) => {
    ran.push([...e.argv])
    return { value: { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('http.fetch', ($, e) => {
    fetched.push(String((e as { url?: unknown }).url ?? e))
    return { value: { status: 200 } as never }
  })
  on('fs.exists', ($, e) => {
    disk()
    return { value: files.has(e.path) || e.path.includes('/prompts/') }
  })
  on('fs.read', ($, e) => {
    disk()
    // Each prompt file reads as its own name, so a test can tell which one a step used.
    if (e.path.includes('/prompts/')) return { value: `prompt:${e.path.split('/').pop()?.replace('.md', '')}` }
    const stored = files.get(e.path)
    return stored ? { value: stored.text } : { deny: `ENOENT ${e.path}` }
  })
  on('fs.write', ($, e) => {
    disk()
    files.set(e.path, { text: e.text, mtimeMs: tick++ })
    return { value: undefined }
  })
  on('fs.stat', ($, e) => {
    disk()
    const stored = files.get(e.path)
    return stored
      ? { value: { kind: 'file' as const, size: stored.text.length, mtimeMs: stored.mtimeMs, isLink: false } }
      : { deny: `ENOENT ${e.path}` }
  })
  on('fs.list', ($, e) =>
    e.path === ROOT
      ? { value: listing.map(name => ({ name, kind: 'file' as const, size: 1, mtimeMs: 1, isLink: false })) }
      : { deny: `ENOENT ${e.path}` },
  )
  on('tool.register', ($, e) => ({ value: { tool: e.name } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('prompt.submit', ($, e) => {
    submitted.push({ text: e.text, context: e.context ?? [] })
    return { text: e.text }
  })
  on('tool.call', { tool: 'Edit' }, () => ({ result: { filePath: 'edited' } as never }))
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.panes', () => ({ value: panes as never }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.copy', ($, e) => {
    copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.close', ($, e) => {
    closed.push(e.id)
    return { value: undefined }
  })

  const roadmap = () => JSON.parse(files.get(FILE)?.text ?? 'null')

  return {
    files,
    submitted,
    panes,
    closed,
    copied,
    toasts,
    opened,
    ran,
    fetched,
    listing,
    breakDisk() {
      broken = true
    },
    roadmap,
    /** Codex, or the user, rewriting the file. */
    editOutside(change: (json: { features: { id: string; status: string }[] }) => void) {
      const json = roadmap()
      change(json)
      files.set(FILE, { text: JSON.stringify(json), mtimeMs: tick++ })
    },
  }
}

export const FEATURES = [
  { id: 'login', title: 'Login screen', status: 'queued', ui_state: 'designed', related_files: ['src/login.tsx'] },
  { id: 'charts', title: 'Charts', status: 'done', ui_state: 'polished', functional_state: 'working', verified_by: 'user' },
  { id: 'sync', title: 'Payments', kind: 'logic', status: 'blocked', blocker_reason: 'Stripe keys' },
]

export const editFile = (path: string) => ({ tool: 'Edit' as const, tool_use_id: path, file_path: path, old_string: 'a', new_string: 'b' })

/** The person running /nowhat: sets the project up when it has no features file, else shows or hides the sidebar. */
export const nowhat = ($: Engine, args = '') => $.command.run({ command: 'nowhat', args, origin: COMPOSER, presentation: PRESENTATION })

/** /nowhat, then Claude saving the features it grouped: how every project gets set up. */
export async function setUp($: Engine, input: Record<string, unknown>) {
  await nowhat($)
  return $.tool.call({ tool: 'mcp__nowhat__setup', tool_use_id: 'setup', ...input } as never)
}
