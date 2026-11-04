// Detection over a demo folder, for the screenshots: the plugin's own pure
// modules fed by real git, the way hooks/register.tsx's gatherEvidence feeds
// them (host CLIs and test runs aside: the demo has no host, and its test
// results come with it). Writes the evidence file the sidebar reads.
//
//   bun scripts/screenshots/evidence.ts <demo folder> <evidence.json>

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import * as d from '../../hooks/detect.ts'
import { LAUNCH_PATTERNS, launchChecks, launchKind, privacyUrlOf } from '../../hooks/launch.ts'
import { reconcile } from '../../hooks/reconcile.ts'
import { detectFolder } from '../detect-folder.ts'

const [root, out] = process.argv.slice(2)
if (!root || !out) throw new Error('usage: bun scripts/screenshots/evidence.ts <demo folder> <evidence.json>')
const git = (args: string[]) => {
  try {
    return execFileSync('git', args, { cwd: root, maxBuffer: 64 << 20 }).toString()
  } catch (error) {
    return (error as { stdout?: Buffer }).stdout?.toString() ?? ''
  }
}
const lines = (text: string) => text.split('\n').filter(Boolean)

const nowMs = Date.now()
const now = new Date(nowMs).toISOString()
const previous = JSON.parse(readFileSync(`${root}/.claude/nowhat/evidence.json`, 'utf8'))
// The same detection the plugin runs, read-only.
const detected = detectFolder(root, nowMs)
const roadmap = detected.roadmap
const features = detected.evidence
const files = lines(git(['ls-files', '--cached', '--others', '--exclude-standard']))
const fileSet = new Set(files)
const manifests = files.filter(path => d.MANIFEST_NAMES.test(path)).map(path => ({ path, text: readFileSync(`${root}/${path}`, 'utf8') }))
const inventory = d.inventoryOf(files, manifests)

// The demo is built so that detection agrees with it: a change here means the demo or the rules drifted.
const changes = reconcile(roadmap, features, now).changes
if (changes.length > 0) {
  console.warn(`detection would change the demo: ${changes.map(change => `${change.id} ${change.field} ${change.from}→${change.to}`).join('; ')}`)
}

const claimed = roadmap.features.flatMap(feature => feature.related_files)
const added = lines(git(['diff', '--name-only', '--diff-filter=A', `${roadmap.synced_commit}..HEAD`]))
const unsorted = d.unsortedFiles([...added, ...lines(git(['ls-files', '--others', '--exclude-standard']))], claimed, roadmap.ignored_files, fileSet)

const kind = launchKind(inventory.frameworks, files)
const exclude = ['--', '.', ':(exclude)*.md', ':(exclude)*.lock', ':(exclude)**/*.test.*', ':(exclude)**/*.spec.*', ':(exclude)**/__tests__/**']
const found = Object.fromEntries(Object.entries(LAUNCH_PATTERNS).map(([key, pattern]) => [key, lines(git(['grep', '-l', '-I', '-i', '-E', '-e', pattern, ...exclude]))]))
const url = privacyUrlOf(lines(git(['grep', '-h', '-o', '-I', '-E', '-e', 'https?://[A-Za-z0-9.-]+/[A-Za-z0-9./_-]*privacy[A-Za-z0-9./_-]*', '--', '.', ':(exclude)*.lock'])))
const appConfig = files.includes('app.json') ? readFileSync(`${root}/app.json`, 'utf8') : null
// The demo's privacy URL is on a reserved domain: it never loads, as noWhat would find.
const checks = kind ? launchChecks({ kind, found, files, appConfig, privacy: { url, status: url ? 0 : null }, deviceBuild: null, liveUrl: null }) : []
const launch = kind ? { kind, checks, privacy: url ? { url, status: 0, checked_at: now } : null, device_build: null } : null

const project = {
  ...previous.project,
  file_count: files.length,
  tests: inventory.tests,
  screens: detected.project.screens,
  ui_style: detected.project.uiStyle,
  pages: detected.project.pages,
  registered_routes: detected.project.routes,
  unmapped_tests: detected.project.unmapped.length,
  unmapped_sample: detected.project.unmapped.slice(0, 30),
  deploy: detected.project.deploy,
}
writeFileSync(out, `${JSON.stringify({ ...previous, checked_at: now, project, features, launch, unsorted, merged: detected.merged }, null, 2)}\n`)
console.log(`evidence: ${Object.keys(features).length} features, ${unsorted.length} unsorted, launch ${checks.filter(check => check.state === 'ok').length}/${checks.length}`)
