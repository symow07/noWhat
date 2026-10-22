// Project-agnostic evidence: what a repository contains, and what that says about
// each feature. Pure functions over text the caller gathered (file lists, git
// output, manifests, CLI output), so tests run them on fixtures from any stack and
// a session runs them on the real thing. register.tsx does the gathering.

// ---------------------------------------------------------------------------
// Files

const LANGUAGES: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  py: 'Python', go: 'Go', rs: 'Rust', rb: 'Ruby', php: 'PHP', java: 'Java',
  kt: 'Kotlin', kts: 'Kotlin', swift: 'Swift', dart: 'Dart', ex: 'Elixir', exs: 'Elixir',
  cs: 'C#', cpp: 'C++', cc: 'C++', hpp: 'C++', c: 'C', h: 'C', vue: 'Vue', svelte: 'Svelte',
  astro: 'Astro', liquid: 'Liquid', scala: 'Scala', lua: 'Lua', zig: 'Zig',
}

const UI_EXT = /\.(tsx|jsx|vue|svelte|astro|html|erb|haml|slim|swift|kt|dart|liquid|razor|cshtml)$|\.blade\.php$/
const SERVER_EXT = /\.(ts|js|mjs|cjs|py|go|rb|php|java|kt|rs|ex|exs|cs|scala)$/

export const extensionOf = (path: string) => /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? ''

export const isSourceFile = (path: string) => extensionOf(path) in LANGUAGES

export function isTestFile(path: string): boolean {
  return (
    /(^|\/)(__tests__|tests?|spec|specs|__mocks__|e2e|cypress|playwright)\//.test(path) ||
    /\.(test|spec|e2e)\.[a-z]+$/i.test(path) ||
    /_(test|spec)\.(go|py|rb|exs|dart)$/.test(path) ||
    /(^|\/)test_[^/]+\.py$/.test(path) ||
    /Tests?\.(swift|kt|java|cs)$/.test(path)
  )
}

export const isDocFile = (path: string) =>
  /\.(md|mdx)$/i.test(path) && (!path.includes('/') || /^docs?\//i.test(path))

const hasFramework = (frameworks: readonly string[], name: string) => frameworks.includes(name)

/**
 * Screens the framework routes by where the file is (Next, Expo Router, SvelteKit,
 * Nuxt, Astro, Remix): reachable by convention, so never "unwired".
 */
export function isRoutedByConvention(path: string, frameworks: readonly string[]): boolean {
  if (isTestFile(path)) return false
  const name = path.split('/').pop() ?? ''
  if (/(^|\/)app\/(.+\/)?(page|route|layout)\.(tsx|jsx|ts|js|mdx)$/.test(path) && hasFramework(frameworks, 'Next.js')) return true
  if (/(^|\/)pages\/.+\.(tsx|jsx|ts|js|vue|astro|svelte|mdx)$/.test(path) && !/pages\/(_app|_document)\./.test(path)) {
    return ['Next.js', 'Nuxt', 'Astro'].some(framework => hasFramework(frameworks, framework))
  }
  if (/(^|\/)routes\/(.+\/)?\+(page|server|layout)\.(svelte|ts|js)$/.test(path)) return true
  if (/(^|\/)app\/routes\/.+\.(tsx|jsx|ts|js)$/.test(path) && hasFramework(frameworks, 'Remix')) return true
  if (/(^|\/)app\/.+\.(tsx|jsx|ts|js)$/.test(path) && hasFramework(frameworks, 'Expo')) return !/^[_+]/.test(name)
  return false
}

/** A file that draws a screen, by the conventions of the common UI stacks. */
export function isScreenFile(path: string, frameworks: readonly string[]): boolean {
  if (isTestFile(path)) return false
  const name = path.split('/').pop() ?? ''
  if (/^[_+]/.test(name) || /\/api\//.test(path)) return false
  if (isRoutedByConvention(path, frameworks)) return UI_EXT.test(path) || /\.(mdx)$/.test(path)
  if (!UI_EXT.test(path)) return false
  if (/(^|\/)(screens|views|templates|pages|routes|sections)\//.test(path)) return true
  return /View\.swift$|(Screen|Activity|Fragment)\.kt$|_(screen|page|view)\.dart$/.test(name)
}

/** A server entry point: route handlers, controllers, resolvers. */
export function isRouteFile(path: string, frameworks: readonly string[]): boolean {
  if (isTestFile(path) || UI_EXT.test(path)) return false
  if (/(^|\/)app\/(.+\/)?route\.(ts|js)$/.test(path) && hasFramework(frameworks, 'Next.js')) return true
  if (/(^|\/)routes\/(.+\/)?\+server\.(ts|js)$/.test(path)) return true
  if (!SERVER_EXT.test(path)) return false
  return (
    /(^|\/)(routes|api|controllers|handlers|endpoints|resolvers|routers)\//.test(path) ||
    /(^|\/)(urls|views)\.py$|_controller\.rb$|Controller\.(java|kt|php|cs)$/.test(path)
  )
}

// ---------------------------------------------------------------------------
// Manifests: frameworks, test commands, hosts

export type Manifest = { path: string; text: string }
export type TestCommand = { dir: string; argv: string[] }
export type HostKind = 'railway' | 'eas' | 'vercel' | 'fly' | 'netlify' | 'dotenv'

const JS_FRAMEWORKS: Record<string, string> = {
  next: 'Next.js', expo: 'Expo', 'react-native': 'React Native', react: 'React', vue: 'Vue', nuxt: 'Nuxt',
  svelte: 'Svelte', '@sveltejs/kit': 'SvelteKit', astro: 'Astro', '@remix-run/react': 'Remix',
  'solid-js': 'Solid', '@angular/core': 'Angular', express: 'Express', fastify: 'Fastify', hono: 'Hono',
  '@nestjs/core': 'NestJS', koa: 'Koa', electron: 'Electron', '@prisma/client': 'Prisma',
  'drizzle-orm': 'Drizzle', '@supabase/supabase-js': 'Supabase', firebase: 'Firebase',
  tailwindcss: 'Tailwind', stripe: 'Stripe', openai: 'OpenAI', '@anthropic-ai/sdk': 'Anthropic',
  'next-auth': 'NextAuth', 'better-auth': 'Better Auth', '@clerk/nextjs': 'Clerk',
  'react-native-purchases': 'RevenueCat', '@sentry/react-native': 'Sentry', '@sentry/node': 'Sentry',
}
const TEXT_FRAMEWORKS: [RegExp, RegExp, string][] = [
  [/(requirements[^/]*\.txt|pyproject\.toml|Pipfile)$/, /\bdjango\b/i, 'Django'],
  [/(requirements[^/]*\.txt|pyproject\.toml|Pipfile)$/, /\bflask\b/i, 'Flask'],
  [/(requirements[^/]*\.txt|pyproject\.toml|Pipfile)$/, /\bfastapi\b/i, 'FastAPI'],
  [/(requirements[^/]*\.txt|pyproject\.toml|Pipfile)$/, /\bstreamlit\b/i, 'Streamlit'],
  [/(requirements[^/]*\.txt|pyproject\.toml|Pipfile)$/, /\bsqlalchemy\b/i, 'SQLAlchemy'],
  [/go\.mod$/, /gin-gonic\/gin/, 'Gin'],
  [/go\.mod$/, /labstack\/echo/, 'Echo'],
  [/go\.mod$/, /gofiber\/fiber/, 'Fiber'],
  [/go\.mod$/, /go-chi\/chi/, 'chi'],
  [/Cargo\.toml$/, /^\s*axum\b/m, 'Axum'],
  [/Cargo\.toml$/, /^\s*actix-web\b/m, 'Actix'],
  [/Cargo\.toml$/, /^\s*tauri\b/m, 'Tauri'],
  [/Gemfile$/, /gem ['"]rails['"]/, 'Rails'],
  [/Gemfile$/, /gem ['"]sinatra['"]/, 'Sinatra'],
  [/composer\.json$/, /laravel\/framework/, 'Laravel'],
  [/pubspec\.yaml$/, /^\s*flutter:/m, 'Flutter'],
  [/mix\.exs$/, /:phoenix\b/, 'Phoenix'],
  [/build\.gradle(\.kts)?$/, /com\.android\.application/, 'Android'],
  [/build\.gradle(\.kts)?$|pom\.xml$/, /spring-boot/, 'Spring Boot'],
]

const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

function jsonOf(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const keysOf = (value: unknown) => (typeof value === 'object' && value !== null ? Object.keys(value) : [])

export function frameworksOf(manifests: readonly Manifest[], files: readonly string[]): string[] {
  const found = new Set<string>()
  for (const manifest of manifests) {
    if (manifest.path.endsWith('package.json')) {
      const json = jsonOf(manifest.text)
      for (const dep of [...keysOf(json?.dependencies), ...keysOf(json?.devDependencies)]) {
        const name = JS_FRAMEWORKS[dep]
        if (name) found.add(name)
        if (dep.startsWith('@remix-run/')) found.add('Remix')
      }
      continue
    }
    for (const [file, pattern, name] of TEXT_FRAMEWORKS) if (file.test(manifest.path) && pattern.test(manifest.text)) found.add(name)
  }
  if (files.some(file => /\.xcodeproj\//.test(file) || file.endsWith('Package.swift'))) found.add('Xcode')
  if (files.some(file => /(^|\/)layout\/theme\.liquid$/.test(file))) found.add('Shopify theme')
  return [...found]
}

const PLACEHOLDER_TEST = /no test specified/

/** How to run each package's tests, from what the repository declares; nothing is guessed. */
export function testCommandsOf(manifests: readonly Manifest[], files: readonly string[]): TestCommand[] {
  const commands: TestCommand[] = []
  const has = (path: string) => files.includes(path)
  const lockIn = (dir: string): string[] | null => {
    for (let at: string | null = dir; at !== null; at = at === '' ? null : dirOf(at)) {
      const prefix = at === '' ? '' : `${at}/`
      if (has(`${prefix}bun.lock`) || has(`${prefix}bun.lockb`)) return ['bun', 'run', 'test']
      if (has(`${prefix}pnpm-lock.yaml`)) return ['pnpm', 'test']
      if (has(`${prefix}yarn.lock`)) return ['yarn', 'test']
      if (has(`${prefix}package-lock.json`)) return ['npm', 'test', '--silent']
    }
    return null
  }

  for (const manifest of manifests) {
    const dir = dirOf(manifest.path)
    const name = manifest.path.split('/').pop() ?? ''
    if (name === 'package.json') {
      const scripts = jsonOf(manifest.text)?.scripts as Record<string, unknown> | undefined
      const test = scripts?.test
      if (typeof test === 'string' && !PLACEHOLDER_TEST.test(test)) {
        commands.push({ dir, argv: lockIn(dir) ?? ['npm', 'test', '--silent'] })
      }
    } else if (name === 'pyproject.toml' || name === 'pytest.ini' || name === 'setup.cfg' || /^requirements[^/]*\.txt$/.test(name)) {
      const usesPytest = /pytest/.test(manifest.text) || name === 'pytest.ini'
      const hasTests = files.some(file => file.startsWith(dir === '' ? '' : `${dir}/`) && /(^|\/)test_[^/]+\.py$|_test\.py$/.test(file))
      if (usesPytest || hasTests) commands.push({ dir, argv: ['python3', '-m', 'pytest', '-q'] })
    } else if (name === 'go.mod') commands.push({ dir, argv: ['go', 'test', './...'] })
    else if (name === 'Cargo.toml' && !/^\[workspace\]/m.test(manifest.text)) commands.push({ dir, argv: ['cargo', 'test', '--quiet'] })
    else if (name === 'Gemfile' && /rspec/.test(manifest.text)) commands.push({ dir, argv: ['bundle', 'exec', 'rspec'] })
    else if (name === 'mix.exs') commands.push({ dir, argv: ['mix', 'test'] })
    else if (name === 'Package.swift') commands.push({ dir, argv: ['swift', 'test'] })
    else if (name === 'pubspec.yaml') commands.push({ dir, argv: /^\s*flutter:/m.test(manifest.text) ? ['flutter', 'test'] : ['dart', 'test'] })
    else if (name === 'composer.json' && /phpunit/.test(manifest.text)) commands.push({ dir, argv: ['vendor/bin/phpunit'] })
    else if (name === 'pom.xml') commands.push({ dir, argv: ['mvn', '-q', 'test'] })
    else if (/^build\.gradle(\.kts)?$/.test(name) && has(`${dir === '' ? '' : `${dir}/`}gradlew`)) commands.push({ dir, argv: ['./gradlew', 'test'] })
  }

  const seen = new Set<string>()
  return commands.filter(command => {
    const key = `${command.dir}|${command.argv.join(' ')}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export const MANIFEST_NAMES =
  /(^|\/)(package\.json|pyproject\.toml|pytest\.ini|setup\.cfg|requirements[^/]*\.txt|Pipfile|go\.mod|Cargo\.toml|Gemfile|mix\.exs|Package\.swift|pubspec\.yaml|composer\.json|pom\.xml|build\.gradle(\.kts)?)$/

/** Where the project deploys, from the config files the hosts use. `dotenv` is added by the caller. */
export function hostsOf(files: readonly string[]): HostKind[] {
  const hosts = new Set<HostKind>()
  for (const file of files) {
    const name = file.split('/').pop() ?? ''
    if (name === 'railway.json' || name === 'railway.toml') hosts.add('railway')
    else if (name === 'eas.json') hosts.add('eas')
    else if (name === 'vercel.json' || file.startsWith('.vercel/')) hosts.add('vercel')
    else if (name === 'fly.toml') hosts.add('fly')
    else if (name === 'netlify.toml') hosts.add('netlify')
  }
  return [...hosts]
}

export type Inventory = {
  languages: string[]
  frameworks: string[]
  screens: string[]
  routes: string[]
  tests: string[]
  docs: string[]
  testCommands: TestCommand[]
  hosts: HostKind[]
  fileCount: number
}

/** Everything the project declares about itself, from its file list and manifests. */
export function inventoryOf(files: readonly string[], manifests: readonly Manifest[]): Inventory {
  const counts = new Map<string, number>()
  for (const file of files) {
    const language = LANGUAGES[extensionOf(file)]
    if (language && !isTestFile(file)) counts.set(language, (counts.get(language) ?? 0) + 1)
  }
  const frameworks = frameworksOf(manifests, files)

  return {
    languages: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([language]) => language),
    frameworks,
    screens: files.filter(file => isScreenFile(file, frameworks)),
    routes: files.filter(file => isRouteFile(file, frameworks)),
    tests: files.filter(file => isTestFile(file) && isSourceFile(file)),
    docs: files.filter(isDocFile),
    testCommands: testCommandsOf(manifests, files),
    hosts: hostsOf(files),
    fileCount: files.length,
  }
}

// ---------------------------------------------------------------------------
// Wiring: is a file referenced from anywhere else?

const VAGUE_NAMES = new Set(['index', 'main', 'mod', 'init', '__init__', 'page', 'route', 'layout', 'app', 'utils', 'util',
  'types', 'helpers', 'lib', 'api', 'client', 'server', 'config', 'constants', 'engine', 'store', 'hooks', 'service',
  'model', 'models', 'schema', 'schemas', 'core', 'base', 'common', 'shared', 'routes', 'handler', 'handlers', 'view', 'views'])

const stem = (path: string) => (path.split('/').pop() ?? '').replace(/\.(d\.)?[^.]+$/, '')

/**
 * The words a reference to this file would contain: its import name, made
 * specific (`sync/engine`, `./engine`) when the name alone is common.
 */
export function referenceNames(path: string): string[] {
  let name = stem(path)
  const parts = path.split('/')
  const parent = parts.length > 1 ? (parts[parts.length - 2] ?? '') : ''
  if (/^(index|__init__|mod|main)$/.test(name) && parent) name = parent
  if (!VAGUE_NAMES.has(name) && name.length >= 5) return [name]
  // A short or common name ("me", "engine") is searched as its import path: "routes/me", "./me".
  if (parent && parent !== name) return [`${parent}/${name}`, `./${name}`]
  return name.length >= 3 ? [`./${name}`] : []
}

/** `git grep -o -w -F -e a -e b` output ("path:match") as match → paths. */
export function parseGrepMatches(output: string): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()
  for (const line of output.split('\n')) {
    const at = line.indexOf(':')
    if (at <= 0) continue
    const path = line.slice(0, at)
    const match = line.slice(at + 1).trim()
    if (!match) continue
    if (!found.has(match)) found.set(match, new Set())
    found.get(match)?.add(path)
  }
  return found
}

// ---------------------------------------------------------------------------
// Which tests belong to a file
//
// A bare word is too loose for tests: "import" or "settings" appears in every
// test, and one unrelated failure would take a feature's "working" away. A test
// counts for a file only when it is named for it or imports it by path.

/** The name a file goes by: its stem, or its folder's for index-like files. */
function subjectKey(path: string): string {
  const name = stem(path)
  if (/^(index|__init__|mod|main)$/.test(name)) return dirOf(path).split('/').pop() ?? name
  return name
}

/** What a test file is named for: "me" for me_test.go, test_me.py, MeTests.swift; "me.route" for me.route.test.ts. */
export function testSubject(path: string): string | null {
  const base = path.split('/').pop() ?? ''
  const named =
    /^(.+?)\.(test|spec|e2e)\.[a-z]+$/i.exec(base)?.[1] ??
    /^(.+)_(test|spec)\.[a-z]+$/.exec(base)?.[1] ??
    /^test_(.+)\.py$/.exec(base)?.[1] ??
    /^(.+?)Tests?\.(swift|kt|java|cs)$/.exec(base)?.[1] ??
    null
  if (named === null) return null
  // index.test.ts is named for its folder (the one above __tests__, if that's where it sits).
  if (/^(index|__init__|mod|main)$/.test(named)) return dirOf(path).replace(/\/(__tests__|tests?)$/, '').split('/').pop() ?? named
  return named
}

/** How many source files (tests aside) go by each name, so a shared name can be told apart by folder. */
export function sourceNameCounts(files: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const path of files) {
    if (!isSourceFile(path) || isTestFile(path)) continue
    const key = subjectKey(path)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/**
 * The path ending a test would import this file by: its name when only one
 * source file has it, else its folder and name ("(tabs)/settings").
 */
export function importNames(path: string, counts: ReadonlyMap<string, number>): string[] {
  const key = subjectKey(path)
  const parent = dirOf(path).split('/').pop() ?? ''
  const isIndex = key !== stem(path)
  if ((counts.get(key) ?? 0) <= 1 && key.length >= 3) return [key]
  return parent && !isIndex ? [`${parent}/${key}`] : [key]
}

/**
 * Fixed strings a test contains when it imports `name` by path: '../lib/name',
 * "@/lib/name.ts", `./name`; for a bare name also Python's "from app.name import"
 * and "import name". One `git grep -o -F` over the test files finds them all.
 */
export function importPatterns(name: string): string[] {
  const end = `/${name}`
  const patterns = [`${end}'`, `${end}"`, `${end}\``, `${end}.`]
  if (!name.includes('/')) patterns.push(`.${name} import`, `from ${name} import`, `import ${name}`)
  return patterns
}

/** `git grep -o -F` output for importPatterns as name → the test files that import it. */
export function parseImportMatches(output: string, names: readonly string[]): Map<string, Set<string>> {
  const byPattern = new Map<string, string>()
  for (const name of names) for (const pattern of importPatterns(name)) byPattern.set(pattern, name)
  const found = new Map<string, Set<string>>()
  for (const [match, paths] of parseGrepMatches(output)) {
    const name = byPattern.get(match)
    if (name === undefined) continue
    const into = found.get(name) ?? new Set<string>()
    for (const path of paths) into.add(path)
    found.set(name, into)
  }
  return found
}

type TestIndex = { bySubject: Map<string, string[]>; counts: Map<string, number> }
const testIndexes = new WeakMap<ReadonlySet<string>, TestIndex>()

function testIndexOf(files: ReadonlySet<string>): TestIndex {
  const cached = testIndexes.get(files)
  if (cached) return cached
  const bySubject = new Map<string, string[]>()
  for (const path of files) {
    if (!isTestFile(path)) continue
    const subject = testSubject(path)
    if (subject === null) continue
    bySubject.set(subject, [...(bySubject.get(subject) ?? []), path])
  }
  const index = { bySubject, counts: sourceNameCounts(files) }
  testIndexes.set(files, index)
  return index
}

/** The tests for one source file: named for it (beside it, or anywhere when its name is unique), or importing it by path. */
export function testsFor(path: string, facts: Pick<ProjectFacts, 'files' | 'testImports'>): string[] {
  const { bySubject, counts } = testIndexOf(facts.files)
  const key = subjectKey(path)
  const unique = (counts.get(key) ?? 0) <= 1
  const home = dirOf(path)
  const found = new Set<string>()
  for (const [subject, tests] of bySubject) {
    if (subject !== key && !subject.startsWith(`${key}.`)) continue
    for (const test of tests) {
      const at = dirOf(test)
      if (unique || at === home || at === `${home}/__tests__` || at === `${home}/tests`) found.add(test)
    }
  }
  for (const name of importNames(path, counts)) for (const test of facts.testImports?.get(name) ?? []) found.add(test)
  return [...found]
}

/** Folders whose files are never a feature's: dependencies, builds, caches. */
const NOT_CODE = /(^|\/)(node_modules|vendor|dist|build|out|\.next|\.expo|Pods|\.venv|venv|__pycache__|target|coverage|generated|\.claude)\//

/**
 * The new source files no feature claims: added since the last sort (or still
 * untracked), not tests, docs or dependencies, not under any feature's files
 * (a feature may name a folder), and not left out on purpose by a sort.
 */
export function unsortedFiles(
  candidates: readonly string[],
  claimed: readonly string[],
  ignored: readonly string[],
  existing: ReadonlySet<string>,
): string[] {
  const covers = (owners: readonly string[], path: string) =>
    owners.some(owner => path === owner || path.startsWith(`${owner.replace(/\/$/, '')}/`))
  return [
    ...new Set(
      candidates
        .map(path => path.trim())
        .filter(path => path !== '' && existing.has(path) && isSourceFile(path) && !isTestFile(path) && !isDocFile(path) && !NOT_CODE.test(path))
        .filter(path => !covers(claimed, path) && !covers(ignored, path)),
    ),
  ]
    .sort()
    .slice(0, 100)
}

/** `git grep -c` output ("path:count") as path → count. */
export function parseGrepCounts(output: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const line of output.split('\n')) {
    const at = line.lastIndexOf(':')
    if (at <= 0) continue
    const count = Number(line.slice(at + 1))
    if (Number.isFinite(count)) counts.set(line.slice(0, at), count)
  }
  return counts
}

/** Marker words that say code is unfinished, for `git grep -E`. */
export const MARKER_PATTERN = 'TODO|FIXME|XXX|HACK|[Nn]ot implemented|NotImplemented|unimplemented!|todo!\\('

// ---------------------------------------------------------------------------
// Git activity

export type Activity = { last: string; recent: number }

export type Commit = { hash: string; at: string; subject: string }

/** The `git log` format the parsers below read: `@@<ISO date>\t<hash>\t<subject>`, then the files. */
export const LOG_FORMAT = '--format=@@%cI%x09%h%x09%s'

/** `git log --name-only` in LOG_FORMAT as path → its latest commits, newest first, `keep` each. */
export function parseGitCommits(output: string, keep = 3): Map<string, Commit[]> {
  const commits = new Map<string, Commit[]>()
  let current: Commit | null = null
  for (const line of output.split('\n')) {
    if (line.startsWith('@@')) {
      const [at = '', hash = '', ...subject] = line.slice(2).split('\t')
      current = { hash, at: at.trim(), subject: subject.join('\t').trim() }
      continue
    }
    const path = line.trim()
    if (!path || !current) continue
    const list = commits.get(path) ?? []
    if (list.length < keep) list.push(current)
    commits.set(path, list)
  }
  return commits
}

/**
 * `git log --name-only --format=@@%cI` as path → its last change and how many
 * commits touched it in the last `days` days before `nowMs`.
 */
export function parseGitActivity(output: string, nowMs: number, days = 30): Map<string, Activity> {
  const activity = new Map<string, Activity>()
  const since = nowMs - days * 86_400_000
  let when = ''
  for (const line of output.split('\n')) {
    if (line.startsWith('@@')) {
      when = (line.slice(2).split('\t')[0] ?? '').trim()
      continue
    }
    const path = line.trim()
    if (!path || !when) continue
    const seen = activity.get(path)
    const isRecent = Date.parse(when) >= since
    if (!seen) activity.set(path, { last: when, recent: isRecent ? 1 : 0 })
    else {
      if (Date.parse(when) > Date.parse(seen.last)) seen.last = when
      if (isRecent) seen.recent += 1
    }
  }
  return activity
}

/** `git status --porcelain` as the paths with uncommitted changes. */
export function parseStatus(output: string): Set<string> {
  return new Set(
    output
      .split('\n')
      .filter(line => line.trim() !== '')
      .map(line => line.slice(3).split(' -> ').pop()?.replace(/^"|"$/g, '') ?? '')
      .filter(path => path !== ''),
  )
}

// ---------------------------------------------------------------------------
// Configuration: which env vars code needs, and which a host has

export type EnvRead = { name: string; optional: boolean }

const ENV_READS: RegExp[] = [
  /process\.env\.([A-Z][A-Z0-9_]+)/g,
  /process\.env\[\s*['"`]([A-Z][A-Z0-9_]+)['"`]\s*\]/g,
  /import\.meta\.env\.([A-Z][A-Z0-9_]+)/g,
  /(?:Deno\.env\.get|Bun\.env\.get)\(\s*['"]([A-Z][A-Z0-9_]+)['"]/g,
  /Bun\.env\.([A-Z][A-Z0-9_]+)/g,
  /os\.environ(?:\.get)?\s*[[(]\s*['"]([A-Z][A-Z0-9_]+)['"]/g,
  /os\.getenv\(\s*['"]([A-Z][A-Z0-9_]+)['"]/g,
  /os\.(?:Getenv|LookupEnv)\(\s*"([A-Z][A-Z0-9_]+)"/g,
  /ENV(?:\.fetch\(\s*|\[\s*)['"]([A-Z][A-Z0-9_]+)['"]/g,
  /env::var(?:_os)?\(\s*"([A-Z][A-Z0-9_]+)"/g,
  /System\.getenv\(\s*"([A-Z][A-Z0-9_]+)"/g,
  /System\.(?:get_env|fetch_env!?)\(\s*"([A-Z][A-Z0-9_]+)"/g,
  /\bgetenv\(\s*['"]([A-Z][A-Z0-9_]+)['"]/g,
  /\benv\(\s*['"]([A-Z][A-Z0-9_]+)['"]/g,
  /environment\[\s*"([A-Z][A-Z0-9_]+)"\s*\]/g,
  /\b(?:env|ENV|Env|config|settings)\.([A-Z][A-Z0-9_]{2,})\b/g,
]

/** A read is optional when the code supplies a fallback or only compares it (a feature flag). */
const OPTIONAL_AFTER = /^[\s)\]'"`]*(\?\?|\|\||\?\.|===|!==|==|!=|,\s*['"\w]|\.(optional|default|unwrap_or)\b|\bor\b)/

/** The env vars a source file reads, by name, and whether every read of each has a fallback. */
export function envReads(text: string): EnvRead[] {
  const reads = new Map<string, boolean>()
  for (const pattern of ENV_READS) {
    pattern.lastIndex = 0
    for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
      const name = match[1]
      if (!name) continue
      const after = text.slice(match.index + match[0].length, match.index + match[0].length + 60)
      const optional = OPTIONAL_AFTER.test(after)
      reads.set(name, (reads.get(name) ?? true) && optional)
    }
  }
  return [...reads].map(([name, optional]) => ({ name, optional }))
}

/**
 * Names an env module (a zod or pydantic schema) gives a working default. A bare
 * `.optional()` is not one: the app boots without the key, but the feature that
 * reads it is switched off, so for the feature it is still needed.
 */
export function optionalInSchema(text: string): Set<string> {
  const optional = new Set<string>()
  for (const line of text.split('\n')) {
    const match = /^\s*([A-Z][A-Z0-9_]{2,})\s*[:=]/.exec(line)
    if (match?.[1] && /\.(default|catch)\(|=\s*['"\d]|\bor\s+['"\d]/.test(line)) optional.add(match[1])
  }
  return optional
}

/** Every env name a schema module or a `.env.example` declares, whether or not it has a default. */
export function declaredNames(text: string): string[] {
  const names = new Set<string>()
  for (const line of text.split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]{2,})\s*[:=]/.exec(line)
    if (match?.[1]) names.add(match[1])
  }
  return [...names]
}

export const ENV_MODULE = /(^|\/)(env|config|settings)(\/index)?\.(ts|js|mjs|py)$/

const PLATFORM_VARS = /^(PORT|HOST|HOSTNAME|NODE_ENV|CI|TZ|HOME|PATH|PWD|USER|SHELL|LANG|TERM|DEBUG|LOG_LEVEL|ENV|ENVIRONMENT|APP_ENV|RAILWAY_.*|VERCEL.*|FLY_.*|RENDER.*|NETLIFY.*|HEROKU_.*|AWS_LAMBDA_.*|K_SERVICE|EAS_.*|EXPO_PUBLIC_DEV.*|.*_TEST|TEST_.*|RUN_.*)$/

/** Set by the platform or only meaningful in development: never "missing". */
export const isPlatformVar = (name: string) => PLATFORM_VARS.test(name)

/** Baked into a client build (the browser or the app) rather than read by a server. */
export const isClientVar = (name: string) => /^(EXPO_PUBLIC_|NEXT_PUBLIC_|VITE_|REACT_APP_|PUBLIC_|NUXT_PUBLIC_|GATSBY_)/.test(name)

/** Upper-snake names in any host's output: JSON keys, `NAME=value` lines, or table rows. */
export function envNamesFrom(output: string, kind: HostKind): string[] {
  const names = new Set<string>()
  const add = (name: string) => {
    if (/^[A-Z][A-Z0-9_]{1,}$/.test(name)) names.add(name)
  }
  const trimmed = output.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const json = (() => {
      try {
        return JSON.parse(trimmed) as unknown
      } catch {
        return null
      }
    })()
    if (Array.isArray(json)) {
      for (const item of json) {
        const record = item as Record<string, unknown>
        const name = record.Name ?? record.name ?? record.key
        if (typeof name === 'string') add(name)
      }
    } else if (json && typeof json === 'object') {
      for (const key of Object.keys(json)) add(key)
    }
    return [...names]
  }
  for (const line of output.split('\n')) {
    const assign = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]+)\s*=/.exec(line)
    if (assign?.[1]) add(assign[1])
    else if (kind === 'vercel' || kind === 'netlify') {
      const cell = /^\s*([A-Z][A-Z0-9_]+)\s{2,}/.exec(line)
      if (cell?.[1]) add(cell[1])
    }
  }
  return [...names]
}

// ---------------------------------------------------------------------------
// Tests

const TEST_RUNNERS = /\b(bun test|bun run test|npm (run )?test|pnpm (run )?test|yarn (run )?test|npx (vitest|jest|mocha|playwright)|vitest|jest|mocha|pytest|python3? -m pytest|go test|cargo test|rspec|rake test|rails test|mix test|swift test|flutter test|dart test|gradlew test|mvn test|phpunit|deno test)\b/

/** Whether a shell command runs tests, by the runner it calls. */
export const isTestCommand = (command: string) => TEST_RUNNERS.test(command)

const FAIL_LINE = /\b(FAIL|FAILED|[Ff]ailed|[Ff]ail|ERROR|[Ee]rror|panicked)\b|✗|✕|×|\(fail\)/

export type TestRun = { ok: boolean; failing: string[]; passing: string[] }

/**
 * Which known test files a run reported failing or passing. Runners print the
 * file they're in on a line of its own or beside each result; a path is matched
 * by its tail, so output relative to a package directory still lands.
 */
export function parseTestRun(output: string, knownTests: readonly string[], ok: boolean): TestRun {
  const baseCount = new Map<string, number>()
  for (const test of knownTests) {
    const base = test.split('/').pop() ?? test
    baseCount.set(base, (baseCount.get(base) ?? 0) + 1)
  }
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // The whole path, its last two segments, or (Go prints only this) a basename no other test shares.
  const byTail = (line: string) =>
    knownTests.find(test => line.includes(test) || line.includes(test.split('/').slice(-2).join('/'))) ??
    knownTests.find(test => {
      const base = test.split('/').pop() ?? test
      return baseCount.get(base) === 1 && new RegExp(`(^|[\\s/])${escape(base)}\\b`).test(line)
    })
  const failing = new Set<string>()
  const mentioned = new Set<string>()
  let current: string | undefined
  for (const line of output.split('\n')) {
    // Totals ("3 fail", "Tests: 2 failed") belong to no file.
    if (/^\s*\d+\s+(pass|passed|fail|failed|skip|skipped|todo|errors?)\b/i.test(line) || /^\s*(Tests|Test Suites|Test Files|Ran)\b/.test(line)) continue
    const here = byTail(line)
    if (here) {
      current = here
      mentioned.add(here)
    }
    if (FAIL_LINE.test(line) && !/\b0 (fail|failed|errors?)\b/.test(line)) {
      const file = here ?? current
      if (file) failing.add(file)
    }
  }
  if (ok) return { ok, failing: [], passing: [...mentioned] }
  // A red run that named its failures passed the other files it mentions; one that named none can't be split.
  return { ok, failing: [...failing], passing: failing.size > 0 ? [...mentioned].filter(file => !failing.has(file)) : [] }
}

// ---------------------------------------------------------------------------
// One feature's evidence

export type FileEvidence = {
  path: string
  exists: boolean
  /** Referenced from another non-test file (or routed by convention); null for tests and non-code. */
  wired: boolean | null
  screen: boolean
  markers: number
  /** Its last commit, null when git has none (or no git). */
  last_change: string | null
  uncommitted: boolean
}

export type FeatureEvidence = {
  files: FileEvidence[]
  /** Required env vars the feature's files read, platform-provided ones left out. */
  env_required: string[]
  /** Required vars the deploy target doesn't have; empty when it couldn't be checked. */
  env_missing: string[]
  /** Where env_missing was checked, e.g. "Railway (production)"; null when nowhere could be. */
  env_source: string | null
  tests: string[]
  tests_status: 'pass' | 'fail' | 'none' | 'unknown'
  last_change: string | null
  recent_changes: number
  uncommitted: boolean
  /** The latest commits that touched its files, newest first. */
  commits: Commit[]
}

export type EnvPresence = {
  server: { source: string; names: ReadonlySet<string> } | null
  client: { source: string; names: ReadonlySet<string> } | null
}

export type ProjectFacts = {
  frameworks: readonly string[]
  /** Every path the repository has, tracked or not (ignored files excluded). */
  files: ReadonlySet<string>
  /** match → files containing it, for every reference name of every feature file; null without git. */
  references: ReadonlyMap<string, ReadonlySet<string>> | null
  /** import name (importNames) → test files importing it by path; null without git. */
  testImports: ReadonlyMap<string, ReadonlySet<string>> | null
  markers: ReadonlyMap<string, number>
  activity: ReadonlyMap<string, Activity>
  /** Latest commits per file (parseGitCommits). */
  commits: ReadonlyMap<string, readonly Commit[]>
  uncommitted: ReadonlySet<string>
  /** Env reads per feature source file, with schema-declared optional names already applied. */
  envReads: ReadonlyMap<string, readonly EnvRead[]>
  env: EnvPresence
  /** The last known result per test file. */
  testResults: Readonly<Record<string, { ok: boolean; at: string }>>
}

/**
 * The evidence for one feature: its files (`relatedFiles`) and the env vars the
 * code that configures it needs (`declaredConfig`, beyond what its files read).
 */
export function featureEvidence(relatedFiles: readonly string[], facts: ProjectFacts, declaredConfig: readonly string[] = []): FeatureEvidence {
  const files: FileEvidence[] = relatedFiles.map(path => {
    const exists = facts.files.has(path)
    const isCode = isSourceFile(path) || UI_EXT.test(path)
    let wired: boolean | null = null
    if (exists && isCode && !isTestFile(path)) {
      const references = facts.references
      const names = referenceNames(path)
      // No git, or no name a reference could be found by: unknown, never "not wired".
      wired = isRoutedByConvention(path, facts.frameworks)
        ? true
        : references === null || names.length === 0
          ? null
          : names.some(name =>
              [...(references.get(name) ?? [])].some(other => other !== path && !isTestFile(other) && !isDocFile(other)),
            )
    }
    return {
      path,
      exists,
      wired,
      screen: exists && isScreenFile(path, facts.frameworks),
      markers: facts.markers.get(path) ?? 0,
      last_change: facts.activity.get(path)?.last ?? null,
      uncommitted: facts.uncommitted.has(path),
    }
  })

  const required = new Set<string>(declaredConfig.filter(name => !isPlatformVar(name)))
  for (const path of relatedFiles) {
    for (const read of facts.envReads.get(path) ?? []) if (!read.optional && !isPlatformVar(read.name)) required.add(read.name)
  }
  const missing: string[] = []
  const sources = new Set<string>()
  for (const name of required) {
    const side = isClientVar(name) ? facts.env.client : facts.env.server
    if (!side) continue
    sources.add(side.source)
    if (!side.names.has(name)) missing.push(name)
  }

  const tests = [...new Set(relatedFiles.flatMap(path => {
    if (isTestFile(path)) return facts.files.has(path) ? [path] : []
    return facts.files.has(path) && isSourceFile(path) ? testsFor(path, facts) : []
  }))]
  const results = tests.map(test => facts.testResults[test]).filter(result => result !== undefined)
  const tests_status =
    tests.length === 0 ? 'none' : results.some(result => !result.ok) ? 'fail' : results.length > 0 ? 'pass' : 'unknown'

  let last: string | null = null
  let recent = 0
  for (const path of relatedFiles) {
    const seen = facts.activity.get(path)
    if (!seen) continue
    recent += seen.recent
    if (last === null || Date.parse(seen.last) > Date.parse(last)) last = seen.last
  }

  return {
    files,
    env_required: [...required].sort(),
    env_missing: missing.sort(),
    env_source: sources.size > 0 ? [...sources].join(', ') : null,
    tests,
    tests_status,
    last_change: last,
    recent_changes: recent,
    uncommitted: relatedFiles.some(path => facts.uncommitted.has(path)),
    commits: latestCommits(relatedFiles, facts.commits, 4),
  }
}

/** The newest commits across a set of files, each commit once. */
function latestCommits(paths: readonly string[], byFile: ReadonlyMap<string, readonly Commit[]>, keep: number): Commit[] {
  const seen = new Map<string, Commit>()
  for (const path of paths) for (const commit of byFile.get(path) ?? []) seen.set(commit.hash, commit)
  return [...seen.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, keep)
}
