#!/usr/bin/env node
// Builds the Acme Notes demo: a made-up project for trying noWhat or recording
// it, written to a folder of its own (never one of yours). It copies the demo
// app, gives it a git history dated relative to today, and writes the noWhat
// data a few days of work would leave behind.
//
//   node docs/demo/make-demo.mjs [folder]     default: ~/noWhat-demo/acme-notes

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const target = resolve(process.argv[2] ?? join(homedir(), 'noWhat-demo', 'acme-notes'))
if (existsSync(target)) {
  console.error(`${target} already exists. Pass another folder, or remove that one first.`)
  process.exit(1)
}

const now = Date.now()
const UNIT = { m: 60_000, h: 3_600_000, d: 86_400_000 }
/** "@-3d" → three days ago; "@now" → now. */
const when = token => {
  const match = /^@(?:now|-(\d+)([mhd]))$/.exec(token)
  if (!match) throw new Error(`not a date token: ${token}`)
  return match[1] ? now - Number(match[1]) * UNIT[match[2]] : now
}
const iso = ms => new Date(ms).toISOString()
/** Every "@…" string in the template becomes a date; a `day` becomes YYYY-MM-DD. */
const dated = (value, key) => {
  if (Array.isArray(value)) return value.map(item => dated(item))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, dated(v, k)]))
  if (typeof value === 'string' && value.startsWith('@')) return key === 'day' ? iso(when(value)).slice(0, 10) : iso(when(value))
  return value
}

mkdirSync(dirname(target), { recursive: true })
cpSync(join(here, 'acme-notes'), target, { recursive: true })

const run = (args, at) =>
  execFileSync('git', ['-c', 'user.name=Acme Dev', '-c', 'user.email=dev@acme-notes.example', '-c', 'commit.gpgsign=false', ...args], {
    cwd: target,
    env: { ...process.env, GIT_AUTHOR_DATE: iso(at), GIT_COMMITTER_DATE: iso(at) },
  })
    .toString()
    .trim()
const commit = (token, message, files) => {
  run(['add', '--', ...files], when(token))
  run(['commit', '-q', '-m', message], when(token))
  return run(['rev-parse', 'HEAD'], when(token))
}

const history = [
  ['@-21d', 'Sign in with a magic link', ['app/_layout.tsx', 'app/sign-in.tsx', 'src/lib/auth.ts', 'src/lib/auth.spec.ts']],
  ['@-15d', 'Settings screen', ['app/settings/index.tsx', 'src/lib/settings.ts', 'src/lib/settings.spec.ts']],
  ['@-12d', 'Notes list', ['app/(tabs)/index.tsx', 'src/lib/notes.ts', 'src/lib/notes.spec.ts']],
  ['@-9d', 'Offline sync on SQLite', ['src/lib/sync.ts', 'src/lib/sync.spec.ts']],
  ['@-6d', 'Tag picker', ['app/tags.tsx', 'src/lib/tags.ts']],
  ['@-5d', 'Paywall and restore', ['app/paywall.tsx', 'src/lib/billing.ts']],
  ['@-4d', 'Delete the account from settings', ['app/settings/delete-account.tsx', 'src/lib/account.ts', 'src/lib/account.spec.ts']],
  ['@-3d', 'Search and share links', ['src/lib/search.ts', 'app/share/[token].tsx', 'src/lib/share.ts']],
  ['@-1d', 'Editor toolbar and undo', ['app/note/[id].tsx', 'src/lib/editor.ts', 'src/lib/editor.spec.ts']],
]

// Everything the history doesn't name goes in the first commit (the project's scaffolding).
const listed = new Set(history.flatMap(([, , files]) => files))
const walk = dir => readdirSync(dir).flatMap(name => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [relative(target, join(dir, name))]))
const scaffolding = walk(target).filter(file => !listed.has(file))

run(['init', '-q', '-b', 'main'], when('@-22d'))
commit('@-22d', 'Start Acme Notes', scaffolding)
let sorted = null
for (const [token, message, files] of history) sorted = commit(token, message, files)

// After the last sort: a rewrite that broke a test, and two files no feature claims yet.
writeFileSync(join(target, 'src/lib/sync.ts'), readFileSync(join(target, 'src/lib/sync.ts'), 'utf8') + '\n// Merge now keeps the newest edit per field.\n')
writeFileSync(join(target, 'src/lib/markdown.ts'), 'export function toMarkdown(body: string) {\n  return body\n}\n')
commit('@-2h', 'Rewrite conflict merge; markdown helpers', ['src/lib/sync.ts', 'src/lib/markdown.ts'])
writeFileSync(join(target, 'src/lib/pdf.ts'), 'export function toPdf(body: string) {\n  return body.length\n}\n')

// The data a few days of work leave behind.
const data = dated(JSON.parse(readFileSync(join(here, 'nowhat.template.json'), 'utf8')))
data.synced_commit = sorted
data.synced_at = iso(when('@-1d'))
const evidence = dated(JSON.parse(readFileSync(join(here, 'evidence.template.json'), 'utf8')))
mkdirSync(join(target, '.claude/nowhat'), { recursive: true })
writeFileSync(join(target, '.claude/nowhat.json'), `${JSON.stringify(data, null, 2)}\n`)
writeFileSync(join(target, '.claude/nowhat/evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`)

console.log(`Acme Notes is ready at ${target}

Open that folder in Claude Code and run /nowhat: it turns noWhat on there and opens the sidebar.
It's a demo: delete the folder when you're done.`)
