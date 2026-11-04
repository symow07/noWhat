// Detection over a folder, read-only: the plugin's own pure modules fed by real
// git and the files on disk, the way hooks/register.tsx's gatherEvidence feeds
// them. Host CLIs and test runs aren't asked: their last answers come from the
// folder's evidence file, as in a cached check. Nothing is written, and git
// runs with GIT_OPTIONAL_LOCKS=0 so it doesn't even refresh its index.
//
//   bun scripts/detect-folder.ts <folder>          a report of what detection makes of it
//   bun scripts/detect-folder.ts <folder> --json   the same as JSON

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import * as d from '../hooks/detect.ts'
import { healthOf, liveOf, scopeWeek, weeklySummary } from '../hooks/insights.ts'
import { reconcile } from '../hooks/reconcile.ts'
import { type Roadmap, progressOf, validate } from '../hooks/schema.ts'
import { rowPill } from '../hooks/view.tsx'

/** Text read per check, as the plugin reads it. */
const SCAN_BYTES = 96_000_000
const SCAN_FILE_BYTES = 8_000_000

type Previous = {
  hosts?: d.HostNames[]
  live?: { ok: boolean | null; status: number | null; commit?: string | null } | null
  host_deploy?: { commit: string; source: string } | null
  launch?: { store_commit?: string | null } | null
  test_runs?: { ok: boolean | null }[]
  test_results?: Record<string, { ok: boolean; at: string }>
}

export type FolderDetection = {
  roadmap: Roadmap
  /** The roadmap after detection settles (each pass is one check of the plugin's). */
  settled: Roadmap
  passes: number
  evidence: Record<string, d.FeatureEvidence>
  project: {
    files: number
    scanned: number
    complete: boolean
    scanMs: number
    uiStyle: d.UiStyle
    screens: number
    pages: number
    routes: number
    tests: number
    unmapped: string[]
    suite: 'pass' | 'fail' | null
    coverage: string[]
    deploy: { source: string; commit: string; changed: number } | null
    hosts: string[]
  }
  merged: { at: string; pr: number | null; features: string[] }[]
}

export function detectFolder(root: string, nowMs = Date.now()): FolderDetection {
  const now = new Date(nowMs).toISOString()
  const git = (args: string[]): string | null => {
    const ran = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })
    return ran.status === 0 ? ran.stdout : null
  }
  const lines = (text: string | null) => (text ?? '').split('\n').filter(Boolean)
  const read = (path: string) => readFileSync(`${root}/${path}`, 'utf8')

  const roadmap = validate(JSON.parse(read('.claude/nowhat.json')), now).roadmap
  if (!roadmap) throw new Error(`${root}/.claude/nowhat.json doesn't validate`)
  const previous: Previous = existsSync(`${root}/.claude/nowhat/evidence.json`) ? JSON.parse(read('.claude/nowhat/evidence.json')) : {}
  const registry = existsSync(`${homedir()}/.claude/nowhat-projects.json`) ? JSON.parse(readFileSync(`${homedir()}/.claude/nowhat-projects.json`, 'utf8')) : { projects: [] }
  const allowed = (registry.projects as { path: string; check_hosts?: boolean }[]).find(entry => entry.path === root)?.check_hosts === true

  const listed = git(['ls-files', '--cached', '--others', '--exclude-standard'])
  if (listed === null) throw new Error(`${root} is not a git repository`)
  const files = [...new Set(lines(listed).filter(path => !/(^|\/)(node_modules|vendor|dist|build|out|\.next|\.expo|Pods|\.venv|venv|__pycache__|target|\.git)\//.test(path)))]
  const fileSet = new Set(files)
  const manifests = files.filter(path => d.MANIFEST_NAMES.test(path)).slice(0, 40).flatMap(path => {
    try {
      const text = read(path)
      return text.length <= 400_000 ? [{ path, text }] : []
    } catch {
      return []
    }
  })
  const inventory = d.inventoryOf(files, manifests)
  const related = [...new Set(roadmap.features.flatMap(feature => feature.related_files))]
  const sources = related.filter(path => fileSet.has(path) && d.isSourceFile(path) && !d.isTestFile(path))
  const testFiles = files.filter(path => d.isTestFile(path) && d.isSourceFile(path))

  const started = Date.now()
  const texts = new Map<string, string>()
  let complete = true
  let total = 0
  for (const path of files.filter(d.isScannable)) {
    try {
      const text = read(path)
      if (text.length > SCAN_FILE_BYTES || total + text.length > SCAN_BYTES) {
        complete = false
        continue
      }
      total += text.length
      texts.set(path, text)
    } catch {
      complete = false
    }
  }
  const scan = d.scanFacts(files, texts, inventory.frameworks, related)
  const scanMs = Date.now() - started

  const log = git(['log', '--since=90.days.ago', '--no-merges', '--name-only', d.LOG_FORMAT]) ?? ''
  const merges = d.parseMerges(git(['log', '--first-parent', '--since=8.days.ago', '-m', '--name-only', d.LOG_FORMAT, 'HEAD']) ?? '')
  const uncommitted = d.parseStatus(git(['status', '--porcelain', '--untracked-files=all']) ?? '')

  const envReads = new Map(sources.flatMap(path => (texts.has(path) ? [[path, d.envReads(texts.get(path) ?? '')] as const] : [])))
  // The last host answers, with what the next host check adds from the repository (an EAS build profile's names).
  const easJson = files.find(path => /(^|\/)eas\.json$/.test(path))
  const profile = easJson ? d.easProfileNames(read(easJson)) : []
  const hosts = d.withoutLocalEnv(allowed ? (previous.hosts ?? []) : []).map(host =>
    host.kind === 'eas' && host.ok ? { ...host, names: [...new Set([...host.names, ...profile])] } : host,
  )
  const live = allowed ? (previous.live ?? null) : null
  const testRuns = previous.test_runs ?? []
  const testResults = previous.test_results ?? {}
  const suite = d.suiteOf(testRuns, testResults)

  // Coverage: the newest report in each package.
  const coverageReports: Parameters<typeof d.mergeCoverage>[0][number][] = []
  for (const dir of [...new Set(['', ...inventory.testCommands.map(command => command.dir)])]) {
    const found = d.COVERAGE_REPORTS.map(report => (dir === '' ? report : `${dir}/${report}`))
      .filter(path => existsSync(`${root}/${path}`))
      .map(path => ({ path, mtimeMs: statSync(`${root}/${path}`).mtimeMs }))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
    if (!found) continue
    const parsed = d.parseCoverage(found.path, read(found.path), root, fileSet)
    if (parsed.size > 0) coverageReports.push({ path: found.path, atMs: found.mtimeMs, found: parsed })
  }
  const merged = coverageReports.length > 0 ? d.mergeCoverage(coverageReports) : null

  const marker = d.deployRefOf(git(['for-each-ref', '--format=%(refname)%09%(objectname)%09%(creatordate:iso-strict)', 'refs/heads', 'refs/remotes', 'refs/tags']) ?? '')
  const deployed =
    (live?.commit ? { commit: live.commit, source: 'the deployed app' } : null) ??
    (allowed && previous.host_deploy ? { commit: previous.host_deploy.commit, source: previous.host_deploy.source } : null) ??
    (marker ? { commit: marker.commit, source: marker.ref.replace(/^refs\/(heads|remotes|tags)\//, '') } : null) ??
    (allowed && previous.launch?.store_commit ? { commit: previous.launch.store_commit, source: 'the newest store build' } : null)
  const changed = deployed ? git(['diff', '--name-only', deployed.commit, 'HEAD']) : null
  const deploy = deployed && changed !== null ? { ...deployed, changed: new Set(lines(changed)) } : null

  const facts: d.ProjectFacts = {
    frameworks: inventory.frameworks,
    files: fileSet,
    references: scan.references,
    referencesComplete: complete,
    testImports: scan.testImports,
    routeTests: scan.routeTests,
    pages: scan.pages,
    markers: scan.markers,
    activity: d.parseGitActivity(log, nowMs),
    commits: d.parseGitCommits(log),
    uncommitted,
    envReads,
    env: d.envPresenceOf(hosts),
    testResults,
    suite,
    coverage: merged,
    deploy,
  }
  const evidence: Record<string, d.FeatureEvidence> = {}
  for (const feature of roadmap.features) {
    if (feature.related_files.length > 0) evidence[feature.id] = d.featureEvidence(feature.related_files, facts, feature.needs_config)
  }
  const mapped = new Set(Object.values(evidence).flatMap(ev => ev.tests))
  const owners = (path: string) =>
    roadmap.features.filter(feature => feature.related_files.some(file => path === file || path.startsWith(`${file.replace(/\/$/, '')}/`))).map(feature => feature.id)

  // Each pass is one check: the plugin re-checks every five minutes while the sidebar shows.
  let settled = roadmap
  let passes = 0
  for (; passes < 5; passes += 1) {
    const next = reconcile(settled, evidence, now)
    if (next.changes.length === 0) break
    settled = next.roadmap
  }

  return {
    roadmap,
    settled,
    passes,
    evidence,
    project: {
      files: files.length,
      scanned: texts.size,
      complete,
      scanMs,
      uiStyle: scan.uiStyle,
      screens: d.screenCount(inventory.screens, scan.pages, scan.pageRoutes),
      pages: scan.pages.size,
      routes: scan.routes.length,
      tests: testFiles.length,
      unmapped: testFiles.filter(test => !mapped.has(test)),
      suite,
      coverage: merged?.paths ?? [],
      deploy: deploy ? { source: deploy.source, commit: deploy.commit.slice(0, 7), changed: deploy.changed.size } : null,
      hosts: hosts.map(host => `${host.label}: ${host.ok ? `${host.names.length} names` : 'not read'}`),
    },
    merged: merges.map(merge => ({ at: merge.at, pr: merge.pr, features: [...new Set(merge.files.flatMap(owners))] })),
  }
}

/** The figures the sidebar shows, before (as stored) and after detection. */
export function figures(result: FolderDetection, nowMs = Date.now()) {
  const of = (roadmap: Roadmap) => {
    const p = progressOf(roadmap.features)
    const counts = Object.entries(p.counts).filter(([, count]) => count > 0).map(([status, count]) => `${status} ${count}`).join(', ')
    const pills = new Map<string, number>()
    for (const feature of roadmap.features) {
      const label = rowPill(feature, result.evidence[feature.id], { nowMs, capabilities: { tests: result.project.tests > 0, hosts: false, git: true } }).label
      pills.set(label, (pills.get(label) ?? 0) + 1)
    }
    return {
      oldOverall: p.functional === null ? null : p.ui === null ? p.functional : Math.round((p.ui + p.functional) / 2),
      ui: p.ui,
      functional: p.functional,
      built: p.built,
      builtCount: p.builtCount,
      planned: p.planned,
      statuses: counts,
      pills: [...pills].map(([label, count]) => `${label} ${count}`).join(', '),
      health: healthOf(roadmap, result.evidence, nowMs),
      live: liveOf(roadmap, result.evidence).live,
      milestones: roadmap.milestones.map(milestone => {
        const mp = progressOf(roadmap.features.filter(feature => feature.milestone === milestone.id))
        return `${milestone.title}: ${mp.builtCount} of ${mp.planned} built · ${mp.built === null ? 'unknown' : `${mp.built}%`}`
      }),
      week: scopeWeek(roadmap, nowMs, result.merged),
      summary: weeklySummary(roadmap, result.evidence, nowMs, result.merged),
    }
  }
  return { before: of(result.roadmap), after: of(result.settled) }
}

if (import.meta.main) {
  const [root, flag] = process.argv.slice(2)
  if (!root) throw new Error('usage: bun scripts/detect-folder.ts <folder> [--json]')
  const result = detectFolder(root)
  const shown = figures(result)
  if (flag === '--json') console.log(JSON.stringify({ project: result.project, passes: result.passes, ...shown }, null, 2))
  else {
    const { before, after } = shown
    const known = (value: number | null) => (value === null ? 'unknown' : `${value}%`)
    const ui = (value: number | null) => (result.project.screens === 0 && after.ui === 0 ? 'unknown' : known(value))
    console.log(
      [
        `${result.roadmap.name}: ${result.project.files} files, ${result.project.scanned} read in ${result.project.scanMs}ms${result.project.complete ? '' : ' (not all)'}`,
        `Before (as stored): ${known(before.oldOverall)} · UI ${known(before.ui)} · works ${known(before.functional)} · ${before.statuses}`,
        `After: built ${known(after.built)} (${after.builtCount} of ${after.planned}) · live ${after.live === null ? 'unknown' : `${after.live}%`} · UI ${ui(after.ui)} (${result.project.uiStyle}, ${result.project.screens} screens, ${result.project.pages} pages) · ${after.statuses}`,
        `Rows: ${after.pills}`,
        `Health: ${before.health.label} → ${after.health.label} (${after.health.detail})`,
        ...after.milestones.map(line => `Milestone ${line}`),
        `Tests: ${result.project.tests} files, ${result.project.unmapped.length} map to no feature; suite ${result.project.suite ?? 'unknown'}; ${result.project.routes} routes`,
        `Deploy: ${result.project.deploy ? `${result.project.deploy.commit} from ${result.project.deploy.source}, ${result.project.deploy.changed} files since` : 'not seen'}; hosts: ${result.project.hosts.join('; ') || 'off'}`,
        `This week: done ${after.week.done.length}, ${after.week.merges.length} PRs merged`,
        `Summary: ${after.summary.split('\n').slice(1, 2).join('')}`,
        `Settled in ${result.passes} check${result.passes === 1 ? '' : 's'}`,
      ].join('\n'),
    )
  }
}
