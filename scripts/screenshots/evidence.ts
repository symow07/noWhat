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
import { validate } from '../../hooks/schema.ts'

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
const roadmap = validate(JSON.parse(readFileSync(`${root}/.claude/nowhat.json`, 'utf8')), now).roadmap
if (!roadmap) throw new Error(`${root}/.claude/nowhat.json doesn't validate`)
const previous = JSON.parse(readFileSync(`${root}/.claude/nowhat/evidence.json`, 'utf8'))

const files = lines(git(['ls-files', '--cached', '--others', '--exclude-standard']))
const fileSet = new Set(files)
const manifests = files.filter(path => d.MANIFEST_NAMES.test(path)).map(path => ({ path, text: readFileSync(`${root}/${path}`, 'utf8') }))
const inventory = d.inventoryOf(files, manifests)
const existing = [...new Set(roadmap.features.flatMap(feature => feature.related_files))].filter(path => fileSet.has(path))
const sources = existing.filter(path => d.isSourceFile(path) && !d.isTestFile(path))

const names = [...new Set(sources.flatMap(d.referenceNames))]
const references = d.parseGrepMatches(git(['grep', '-I', '-o', '-w', '-F', ...names.flatMap(name => ['-e', name]), '--', '.', ':(exclude)*.md', ':(exclude)*.lock']))
const testFiles = files.filter(path => d.isTestFile(path) && d.isSourceFile(path))
const counts = d.sourceNameCounts(files)
const imported = [...new Set(sources.flatMap(path => d.importNames(path, counts)))]
const testImports = d.parseImportMatches(git(['grep', '-I', '-o', '-F', ...imported.flatMap(name => d.importPatterns(name).flatMap(pattern => ['-e', pattern])), '--', ...testFiles]), imported)
const log = git(['log', '--since=90.days.ago', '--no-merges', '--name-only', d.LOG_FORMAT])
const facts = {
  frameworks: inventory.frameworks,
  files: fileSet,
  references,
  testImports,
  markers: d.parseGrepCounts(git(['grep', '-I', '-c', '-E', '-e', d.MARKER_PATTERN, '--', ...existing])),
  activity: d.parseGitActivity(log, nowMs),
  commits: d.parseGitCommits(log),
  uncommitted: d.parseStatus(git(['status', '--porcelain', '--untracked-files=all'])),
  envReads: new Map(sources.map(path => [path, d.envReads(readFileSync(`${root}/${path}`, 'utf8'))])),
  env: { server: null, client: null },
  testResults: previous.test_results,
}
const features = Object.fromEntries(
  roadmap.features.filter(feature => feature.related_files.length > 0).map(feature => [feature.id, d.featureEvidence(feature.related_files, facts, feature.needs_config)]),
)

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

writeFileSync(out, `${JSON.stringify({ ...previous, checked_at: now, project: { ...previous.project, file_count: files.length, tests: inventory.tests }, features, launch, unsorted }, null, 2)}\n`)
console.log(`evidence: ${Object.keys(features).length} features, ${unsorted.length} unsorted, launch ${checks.filter(check => check.state === 'ok').length}/${checks.length}`)
