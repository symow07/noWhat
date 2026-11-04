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

/** Page templates a server renders: Express, Django, Rails, Phoenix, Go and the rest. */
const TEMPLATE_EXT = /\.(ejs|hbs|handlebars|mustache|njk|jinja2?|j2|twig|pug|eex|heex|gohtml|tmpl)$/
const UI_EXT = /\.(tsx|jsx|vue|svelte|astro|html|erb|haml|slim|swift|kt|dart|liquid|razor|cshtml|ejs|hbs|handlebars|mustache|njk|jinja2?|j2|twig|pug|eex|heex|gohtml|tmpl)$|\.blade\.php$/
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
  // Phoenix keeps a controller's templates beside it: page_html/home.html.heex.
  if (TEMPLATE_EXT.test(path) && !/(^|\/)(partials?|includes|layouts?|components|emails?|mail(ers)?)\//.test(path)) return true
  return /View\.swift$|(Screen|Activity|Fragment)\.kt$|_(screen|page|view)\.dart$/.test(name)
}

/** What draws the project's screens, decided before any file is called one. */
export type UiStyle = 'components' | 'native' | 'server' | 'none'

const COMPONENT_FRAMEWORKS = ['Next.js', 'Expo', 'React Native', 'React', 'Vue', 'Nuxt', 'Svelte', 'SvelteKit', 'Astro', 'Remix', 'Solid', 'Angular', 'Electron']
const NATIVE_FRAMEWORKS = ['Xcode', 'Android', 'Flutter']
const SERVER_FRAMEWORKS = ['Express', 'Fastify', 'Hono', 'NestJS', 'Koa', 'Django', 'Flask', 'FastAPI', 'Streamlit', 'Gin', 'Echo', 'Fiber', 'chi',
  'Axum', 'Actix', 'Rails', 'Sinatra', 'Laravel', 'Phoenix', 'Spring Boot']

/**
 * The project's UI style, from its frameworks and file types: components
 * (React, Vue, Expo…), native (SwiftUI, Android, Flutter), or a server that
 * renders its own pages. Server pages are found by what the files contain.
 */
export function uiStyleOf(frameworks: readonly string[], files: readonly string[]): UiStyle {
  const has = (names: readonly string[]) => names.some(name => frameworks.includes(name))
  if (has(COMPONENT_FRAMEWORKS) || files.some(file => /\.(tsx|jsx|vue|svelte|astro)$/.test(file) && !isTestFile(file))) return 'components'
  if (has(NATIVE_FRAMEWORKS)) return 'native'
  if (has(SERVER_FRAMEWORKS) || files.some(file => TEMPLATE_EXT.test(file) || /\.(html|erb|haml|slim|liquid)$|\.blade\.php$/.test(file))) return 'server'
  return files.some(file => SERVER_EXT.test(file) && !isTestFile(file)) ? 'server' : 'none'
}

const PAGE_DOCUMENT = /<!doctype html|<html[\s>]/i
const PAGE_TAGS = /<(main|section|form|table|nav|header|footer|article|aside|h1|h2|h3|ul|ol|li|button|input|select|textarea|label|div|span|p|a)\b[^<>]{0,200}>/gi
const RENDER_CALL =
  /\b(?:res|reply|ctx|response)\.(?:render|view)\(|\brender_template\(|\bTemplateResponse\(|\brender\(\s*request\s*,|\.ExecuteTemplate\(|\bc\.HTML\(|['"]text\/html['"]/
/** A page's worth of markup: fewer tags than this is a snippet (an email line, an error string). */
const PAGE_TAG_COUNT = 6

/**
 * A server file that renders a page: an HTML document, a page's worth of
 * markup in its strings, or a template render. Only for the server UI style,
 * where pages are code rather than components.
 */
export function rendersPage(path: string, text: string): boolean {
  if (isTestFile(path) || !SERVER_EXT.test(path)) return false
  if (PAGE_DOCUMENT.test(text) || RENDER_CALL.test(text)) return true
  PAGE_TAGS.lastIndex = 0
  let tags = 0
  while (tags < PAGE_TAG_COUNT && PAGE_TAGS.exec(text) !== null) tags += 1
  return tags >= PAGE_TAG_COUNT
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

/** Metro and Expo pick `name.web.ts` over `name.ts` by platform: both are imported as `name`. */
const PLATFORM_VARIANT = /\.(web|ios|android|native)(?=\.[cm]?[jt]sx?$)/

/** What a file is imported as: a file and its platform variants are one module. */
const moduleOf = (path: string) => path.replace(PLATFORM_VARIANT, '').replace(/\.[cm]?[jt]sx?$/, '')

/**
 * A tool's own config (eslint.config.js, babel.config.js, .eslintrc.cjs): the tool
 * finds it by name and nothing imports it, so never "unwired". Under src/, lib/ or
 * app/, a `.config.ts` is the project's own module, wired like any other.
 */
export function isToolConfig(path: string): boolean {
  return /(^|\/)(\.\w+rc|[\w-]+\.config)\.[cm]?[jt]s$/.test(path) && !/(^|\/)(src|lib|app)\//.test(path)
}

/**
 * The words a reference to this file would contain: its import name, made
 * specific (`sync/engine`, `./engine`) when the name alone is common.
 */
export function referenceNames(path: string): string[] {
  let name = stem(path.replace(PLATFORM_VARIANT, ''))
  const parts = path.split('/')
  const parent = parts.length > 1 ? (parts[parts.length - 2] ?? '') : ''
  if (/^(index|__init__|mod|main)$/.test(name) && parent) name = parent
  if (!VAGUE_NAMES.has(name) && name.length >= 5) return [name]
  // A short or common name ("me", "engine") is searched as its import path: "routes/me", "./me".
  if (parent && parent !== name) return [`${parent}/${name}`, `./${name}`]
  return name.length >= 3 ? [`./${name}`] : []
}

/** Lock files and minified bundles: text, but nothing in them is a reference. */
const NOT_SCANNED = /\.(md|mdx|lock|lockb|map)$|\.min\.(js|css)$|(^|\/)(package-lock\.json|pnpm-lock\.yaml|npm-shrinkwrap\.json|Cargo\.lock|poetry\.lock|go\.sum)$/i
const CONFIG_TEXT = /\.(json|jsonc|ya?ml|toml|xml|plist|gradle|properties|ini|cfg|conf|sql|graphql|gql|css|scss|sass|less|sh|bash|zsh)$/

/** Files whose text is read once per check: code, templates and the configs that name code. */
export const isScannable = (path: string) =>
  !NOT_SCANNED.test(path) && !/(^|\/)(node_modules|vendor|dist|build|out|\.next|\.expo|Pods|\.venv|venv|__pycache__|target|coverage|\.claude)\//.test(path) &&
  (isSourceFile(path) || UI_EXT.test(path) || CONFIG_TEXT.test(path))

const WORD = /[A-Za-z0-9_]+/g
const isWordChar = (char: string | undefined) => char !== undefined && /[A-Za-z0-9_]/.test(char)

/** Each name under the last word in it: a pass over a file's words finds every name ending there. */
function byLastWord(names: readonly string[]): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const name of names) {
    const last = /[A-Za-z0-9_]+$/.exec(name)?.[0]
    if (last) index.set(last, [...(index.get(last) ?? []), name])
  }
  return index
}

/** Every place one of `names` ends in `text`, as [name, start, end]. */
function* occurrences(text: string, index: ReadonlyMap<string, readonly string[]>): Generator<[string, number, number]> {
  WORD.lastIndex = 0
  for (let match = WORD.exec(text); match !== null; match = WORD.exec(text)) {
    const candidates = index.get(match[0])
    if (!candidates) continue
    const end = match.index + match[0].length
    for (const name of candidates) {
      const start = end - name.length
      if (start >= 0 && text.startsWith(name, start)) yield [name, start, end]
    }
  }
}

/**
 * Which files mention each name as a whole word: what `git grep -w -F` finds,
 * in one pass over each file's words, so a large repository takes a fraction
 * of a second rather than minutes.
 */
export function findReferences(texts: Iterable<readonly [string, string]>, names: readonly string[]): Map<string, Set<string>> {
  const index = byLastWord(names)
  const found = new Map<string, Set<string>>()
  for (const [path, text] of texts) {
    for (const [name, start] of occurrences(text, index)) {
      if (isWordChar(text[start - 1])) continue
      const paths = found.get(name) ?? new Set<string>()
      paths.add(path)
      found.set(name, paths)
    }
  }
  return found
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

/** The importPatterns of each name, found in one pass over each test's words: name → the test files that import it. */
export function findImports(texts: Iterable<readonly [string, string]>, names: readonly string[]): Map<string, Set<string>> {
  const index = byLastWord(names)
  const found = new Map<string, Set<string>>()
  for (const [path, text] of texts) {
    for (const [name, start, end] of occurrences(text, index)) {
      const before = text[start - 1]
      const after = text[end]
      const byPath = before === '/' && (after === "'" || after === '"' || after === '`' || after === '.')
      const python =
        !name.includes('/') &&
        (((before === '.' || text.slice(start - 5, start) === 'from ') && text.startsWith(' import', end)) || text.slice(start - 7, start) === 'import ')
      if (!byPath && !python) continue
      const paths = found.get(name) ?? new Set<string>()
      paths.add(path)
      found.set(name, paths)
    }
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

/**
 * The tests for one source file: named for it (beside it, or anywhere when its
 * name is unique), importing it by path, or calling a route it handles.
 */
export function testsFor(path: string, facts: Pick<ProjectFacts, 'files' | 'testImports' | 'routeTests'>): string[] {
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
  for (const test of facts.routeTests?.get(path) ?? []) found.add(test)
  return [...found]
}

// ---------------------------------------------------------------------------
// Routes: tests that reach code through the URLs they call
//
// An integration test rarely imports the page it checks: it calls a URL. The
// route that answers it is registered somewhere, and its handler calls into
// the modules that do the work. Those modules are what the test covers.

/** One registered route: its path, the file registering it, and the files its handler calls into. */
export type Route = { path: string; file: string; handlers: string[] }

/** Route registrations by framework family; the path is always the second group. */
const ROUTE_PATTERNS: RegExp[] = [
  // Express, Fastify, Hono, Koa: app.get('/x', …); Fastify's route({ url: '/x' })
  /\b[A-Za-z_$][\w$]*\.(?:get|post|put|patch|delete|del|all|head|options)\(\s*(['"`])(\/[^'"`\s]*)\1/g,
  /\burl\s*:\s*(['"`])(\/[^'"`\s]*)\1/g,
  // Flask, FastAPI: @app.get("/x"), @bp.route("/x")
  /@[A-Za-z_][\w.]*\.(?:get|post|put|patch|delete|route|api_route)\(\s*(['"])(\/[^'"\s]*)\1/g,
  // Django: path("x/", view)
  /\bpath\(\s*(['"])([^'"\s]*)\1\s*,/g,
  // Rails, Sinatra, Phoenix: get '/x'
  /^\s*(?:get|post|put|patch|delete|live)\s+(['"])(\/[^'"\s]*)\1/gm,
  // Go: r.GET("/x"), mux.HandleFunc("/x")
  /\.(?:GET|POST|PUT|PATCH|DELETE|Get|Post|Put|Patch|Delete|HandleFunc|Handle)\(\s*(")(\/[^"\s]*)"/g,
  // Spring
  /@(?:Get|Post|Put|Patch|Delete|Request)Mapping\(\s*(?:(?:value|path)\s*=\s*)?(")(\/[^"\s]*)"/g,
  // Laravel
  /Route::(?:get|post|put|patch|delete|any)\(\s*(['"])(\/?[^'"\s]*)\1/g,
]

/** Where a mounted router's routes start: app.register(x, { prefix: '/p' }), app.use('/p', x). */
const MOUNTS: RegExp[] = [
  /\.register\(\s*(?:import\(\s*['"]([^'"]+)['"]\s*\)|([A-Za-z_$][\w$]*))[^)]*?prefix\s*:\s*['"`](\/[^'"`]*)['"`]/g,
  /\.(?:use|route)\(\s*['"`](\/[^'"`]*)['"`]\s*,\s*([A-Za-z_$][\w$]*)/g,
]

/** The local names a file imports, each with the module as written: JS/TS and Python. */
export function importedNames(text: string): Map<string, string> {
  const names = new Map<string, string>()
  const add = (local: string, from: string) => {
    if (/^[A-Za-z_$][\w$]*$/.test(local)) names.set(local, from)
  }
  const clause = (list: string, from: string) => {
    for (const part of list.split(',')) {
      const name = part.trim().replace(/^type\s+/, '')
      if (!name) continue
      const renamed = /^[\w$]+\s+as\s+([\w$]+)$/.exec(name) ?? /^[\w$]+\s*:\s*([\w$]+)$/.exec(name)
      add(renamed?.[1] ?? name, from)
    }
  }
  for (const match of text.matchAll(/\bimport\s+(?!type\s)([^'";]+?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const [, spec = '', from = ''] = match
    const braces = /\{([^}]*)\}/.exec(spec)
    if (braces?.[1]) clause(braces[1], from)
    const star = /\*\s+as\s+([\w$]+)/.exec(spec)
    if (star?.[1]) add(star[1], from)
    const first = spec.replace(/\{[^}]*\}/, '').split(',')[0]?.trim() ?? ''
    if (first && !first.startsWith('*')) add(first, from)
  }
  for (const match of text.matchAll(/\b(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const [, spec = '', from = ''] = match
    if (spec.startsWith('{')) clause(spec.slice(1, -1), from)
    else add(spec, from)
  }
  for (const match of text.matchAll(/^\s*from\s+(\.+[\w.]*|[A-Za-z_][\w.]*)\s+import\s+\(?([^)\n]+)\)?/gm)) {
    const [, from = '', list = ''] = match
    for (const part of list.split(',')) {
      const name = part.trim()
      const renamed = /^(\w+)\s+as\s+(\w+)$/.exec(name)
      const local = renamed?.[2] ?? name
      if (!local) continue
      // `from app import views` names a module; `from app.views import home` a function in one: routesIn tries both.
      add(local, `${from}${from.endsWith('.') ? '' : '.'}${renamed?.[1] ?? name}`)
      names.set(`${local}#module`, from)
    }
  }
  return names
}

/** The repository file an import names, tried with the extensions and index files a runtime would. */
export function resolveImport(from: string, importer: string, files: ReadonlySet<string>): string | null {
  const join = (dir: string, rest: string) => {
    const parts: string[] = dir === '' ? [] : dir.split('/')
    for (const part of rest.split('/')) {
      if (part === '..') parts.pop()
      else if (part !== '.' && part !== '') parts.push(part)
    }
    return parts.join('/')
  }
  const probe = (base: string, exts: readonly string[]) => {
    for (const ext of exts) if (files.has(`${base}${ext}`)) return `${base}${ext}`
    return null
  }
  const JS = ['', '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.tsx', '/index.js', '/index.jsx']
  if (from.startsWith('./') || from.startsWith('../')) {
    const base = join(dirOf(importer), from)
    return probe(base, JS) ?? probe(base.replace(/\.(m|c)?js$/, ''), JS)
  }
  if (/^[@~#]\//.test(from)) return probe(join('src', from.slice(2)), JS) ?? probe(from.slice(2), JS)
  if (/^\.+/.test(from) || /^[A-Za-z_][\w]*(\.[A-Za-z_]\w*)+$/.test(from)) {
    // Python: leading dots climb from the importer's package; dotted names are paths from the root (or src/).
    const dots = /^\.*/.exec(from)?.[0].length ?? 0
    const rest = from.slice(dots).replace(/\./g, '/')
    let dir = dirOf(importer)
    for (let up = 1; up < dots; up += 1) dir = dirOf(dir)
    const base = dots > 0 ? join(dir, rest) : rest
    return probe(base, ['.py', '/__init__.py']) ?? (dots === 0 ? probe(`src/${base}`, ['.py', '/__init__.py']) : null)
  }
  return null
}

const PARAM = /^(:[\w$]+\??|\{[^}]+\}|<[^>]+>|\[[^\]]+\]|\*)$/

/** Every route a server file registers, and the files each handler calls into. */
export function routesIn(path: string, text: string, files: ReadonlySet<string>): Route[] {
  if (isTestFile(path) || !SERVER_EXT.test(path)) return []
  const found: { at: number; path: string }[] = []
  for (const pattern of ROUTE_PATTERNS) {
    pattern.lastIndex = 0
    for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
      const route = match[2] ?? ''
      if (/[*]{2}|\$\{/.test(route)) continue
      found.push({ at: match.index, path: route.startsWith('/') ? route : `/${route}` })
    }
  }
  if (found.length === 0) return []
  found.sort((a, b) => a.at - b.at)
  const imported = importedNames(text)
  const fileOf = new Map<string, string | null>()
  const resolved = (name: string) => {
    if (!fileOf.has(name)) {
      const from = imported.get(name)
      // Python's `from x import name`: a module x/name.py, else a function in x.py.
      const module = imported.get(`${name}#module`)
      fileOf.set(name, from === undefined ? null : (resolveImport(from, path, files) ?? (module === undefined ? null : resolveImport(module, path, files))))
    }
    return fileOf.get(name) ?? null
  }
  const statements = [...text.matchAll(/\n\s*[A-Za-z_$][\w$]*\.(?:register|use|listen|ready|addHook|decorate|setErrorHandler|mount)\(/g)].map(match => match.index ?? 0)
  return found.map((route, index) => {
    // The handler: what follows the path up to the next registration or mount, bounded.
    const end = Math.min(found[index + 1]?.at ?? text.length, statements.find(at => at > route.at) ?? text.length, route.at + 4000)
    const handlers = new Set<string>()
    for (const word of text.slice(route.at, end).matchAll(/[A-Za-z_$][\w$]*/g)) {
      const file = resolved(word[0])
      if (file && file !== path) handlers.add(file)
    }
    return { path: route.path, file: path, handlers: [...handlers] }
  })
}

/** Mount prefixes: the file a router lives in → the paths it's mounted under. */
export function mountsIn(path: string, text: string, files: ReadonlySet<string>): Map<string, string[]> {
  const mounts = new Map<string, string[]>()
  const imported = importedNames(text)
  const add = (file: string | null, prefix: string) => {
    if (file) mounts.set(file, [...(mounts.get(file) ?? []), prefix.replace(/\/+$/, '')])
  }
  for (const match of text.matchAll(MOUNTS[0] as RegExp)) {
    const [, dynamic, name, prefix = ''] = match
    add(dynamic ? resolveImport(dynamic, path, files) : name ? resolveImport(imported.get(name) ?? '', path, files) : null, prefix)
  }
  for (const match of text.matchAll(MOUNTS[1] as RegExp)) {
    const [, prefix = '', name = ''] = match
    add(resolveImport(imported.get(name) ?? '', path, files), prefix)
  }
  return mounts
}

/** The paths a test calls: quoted strings and templates that start with a slash, `${…}` read as a parameter. */
export function urlsIn(text: string): string[] {
  const urls = new Set<string>()
  const keep = (raw: string) => {
    const url = raw.replace(/\$\{[^}]*\}/g, ':param').replace(/[?#].*$/, '').replace(/\/+$/, '')
    // The bare root is left out: "/" is every split and join in a test, not a page.
    if (url.length > 1 && !url.startsWith('//')) urls.add(url)
  }
  for (const match of text.matchAll(/(['"])(\/[A-Za-z0-9_\-.~%:@+/]*(?:[?#][^'"\s]*)?)\1/g)) keep(match[2] ?? '')
  for (const match of text.matchAll(/`(\/[^`\s]*)`/g)) keep(match[1] ?? '')
  return [...urls]
}

/** Whether a URL a test calls is answered by a route: parameters match any one segment. */
export function routeMatches(route: string, url: string): boolean {
  const want = route.replace(/\/+$/, '').split('/')
  const got = url.replace(/\/+$/, '').split('/')
  if (want[want.length - 1] === '*') return got.length >= want.length - 1 && want.slice(0, -1).every((segment, index) => segment === got[index] || PARAM.test(segment))
  if (want.length !== got.length) return false
  return want.every((segment, index) => segment === got[index] || PARAM.test(segment))
}

/**
 * Source file → the tests that call a route its handler reaches. A module
 * nearly every handler calls (a layout, the translations, the database) is
 * plumbing, not what the test checks: it's left out.
 */
export function routeTestsOf(routes: readonly Route[], mounts: ReadonlyMap<string, readonly string[]>, tests: Iterable<readonly [string, string]>): Map<string, Set<string>> {
  const used = new Map<string, number>()
  for (const route of routes) for (const file of route.handlers) used.set(file, (used.get(file) ?? 0) + 1)
  const plumbing = (file: string) => routes.length >= 6 && (used.get(file) ?? 0) > routes.length / 3
  const answering = routes.flatMap(route => {
    const targets = route.handlers.filter(file => !plumbing(file))
    const owners = targets.length > 0 ? targets : [route.file]
    const paths = [route.path, ...(mounts.get(route.file) ?? []).map(prefix => `${prefix}${route.path === '/' ? '' : route.path}`)]
    return paths.map(path => ({ path, owners }))
  })
  const found = new Map<string, Set<string>>()
  if (answering.length === 0) return found
  for (const [test, text] of tests) {
    for (const url of urlsIn(text)) {
      for (const route of answering) {
        if (!routeMatches(route.path, url)) continue
        for (const owner of route.owners) {
          const into = found.get(owner) ?? new Set<string>()
          into.add(test)
          found.set(owner, into)
        }
      }
    }
  }
  return found
}

/** What the one-pass read of a project's files says, before git or hosts are asked. */
export type ScanFacts = {
  references: Map<string, Set<string>>
  testImports: Map<string, Set<string>>
  markers: Map<string, number>
  uiStyle: UiStyle
  pages: Set<string>
  routes: Route[]
  routeTests: Map<string, Set<string>>
}

/**
 * Wiring, test imports, TODO markers, server pages and the tests that reach
 * code through routes, all from one read of the files' text. `featureFiles`
 * are the files features claim: their names are what wiring looks for.
 */
export function scanFacts(files: readonly string[], texts: ReadonlyMap<string, string>, frameworks: readonly string[], featureFiles: readonly string[]): ScanFacts {
  const fileSet = new Set(files)
  const existing = featureFiles.filter(path => fileSet.has(path))
  const sources = existing.filter(path => isSourceFile(path) && !isTestFile(path))
  const withText = (paths: readonly string[]) =>
    paths.flatMap(path => {
      const text = texts.get(path)
      return text === undefined ? [] : [[path, text] as const]
    })
  const tests = withText(files.filter(path => isTestFile(path) && isSourceFile(path)))
  const code = withText(files.filter(path => !isTestFile(path) && isSourceFile(path)))
  const counts = sourceNameCounts(files)
  const uiStyle = uiStyleOf(frameworks, files)
  const routes: Route[] = []
  const mounts = new Map<string, string[]>()
  for (const [path, text] of code) {
    routes.push(...routesIn(path, text, fileSet))
    for (const [file, prefixes] of mountsIn(path, text, fileSet)) mounts.set(file, [...(mounts.get(file) ?? []), ...prefixes])
  }
  return {
    references: findReferences(texts, [...new Set(sources.flatMap(referenceNames))]),
    testImports: findImports(tests, [...new Set(sources.flatMap(path => importNames(path, counts)))]),
    markers: new Map(withText(existing).map(([path, text]) => [path, markerCount(text)] as const)),
    uiStyle,
    pages: new Set(uiStyle === 'server' ? code.filter(([path, text]) => rendersPage(path, text)).map(([path]) => path) : []),
    routes,
    routeTests: routeTestsOf(routes, mounts, tests),
  }
}

/** The suite's state from its runs and the last result per test file: failing wins, passing needs every run green. */
export function suiteOf(runs: readonly { ok: boolean | null }[], results: Readonly<Record<string, { ok: boolean }>>): 'pass' | 'fail' | null {
  if (runs.some(run => run.ok === false) || Object.values(results).some(result => !result.ok)) return 'fail'
  return runs.length > 0 && runs.every(run => run.ok === true) ? 'pass' : null
}

// ---------------------------------------------------------------------------
// Coverage: a report the project's own runs left behind

/** Lines run and lines counted per repository file. */
export type CoverageMap = Map<string, { hit: number; total: number }>

/** Where test runners write their reports, relative to a package directory. */
export const COVERAGE_REPORTS = [
  'coverage/lcov.info',
  'coverage/coverage-final.json',
  'coverage/coverage-summary.json',
  'coverage/cobertura-coverage.xml',
  'coverage.xml',
  'coverage/coverage.xml',
  'coverage.out',
  'cover.out',
  'lcov.info',
]

/**
 * A coverage report as repository paths: lcov, Istanbul JSON (final or
 * summary), Cobertura XML, or a Go cover profile. Paths that aren't the
 * repository's (absolute, module-prefixed) are matched by their tail.
 */
export function parseCoverage(report: string, text: string, root: string, files: ReadonlySet<string>): CoverageMap {
  const coverage: CoverageMap = new Map()
  const repoPath = (raw: string): string | null => {
    let path = raw.replace(/^file:\/\//, '').replace(/\\/g, '/')
    if (path.startsWith(`${root}/`)) path = path.slice(root.length + 1)
    path = path.replace(/^\.\//, '')
    const parts = path.split('/')
    for (let start = 0; start < parts.length; start += 1) {
      const tail = parts.slice(start).join('/')
      if (files.has(tail)) return tail
    }
    return null
  }
  const add = (raw: string, hit: number, total: number) => {
    const path = repoPath(raw)
    if (path === null || total <= 0) return
    const seen = coverage.get(path) ?? { hit: 0, total: 0 }
    coverage.set(path, { hit: seen.hit + hit, total: seen.total + total })
  }
  if (/\.info$/.test(report)) {
    for (const record of text.split('end_of_record')) {
      const file = /^SF:(.+)$/m.exec(record)?.[1]
      if (!file) continue
      const lines = [...record.matchAll(/^DA:\d+,(\d+)/gm)]
      if (lines.length > 0) add(file.trim(), lines.filter(line => Number(line[1]) > 0).length, lines.length)
      else add(file.trim(), Number(/^LH:(\d+)/m.exec(record)?.[1] ?? 0), Number(/^LF:(\d+)/m.exec(record)?.[1] ?? 0))
    }
  } else if (/\.json$/.test(report)) {
    try {
      const json = JSON.parse(text) as Record<string, { s?: Record<string, number>; lines?: { total?: number; covered?: number } }>
      for (const [file, entry] of Object.entries(json)) {
        if (file === 'total' || typeof entry !== 'object' || entry === null) continue
        if (entry.s) {
          const counts = Object.values(entry.s)
          add(file, counts.filter(count => count > 0).length, counts.length)
        } else if (entry.lines) add(file, entry.lines.covered ?? 0, entry.lines.total ?? 0)
      }
    } catch {
      // Not a report: no coverage from it.
    }
  } else if (/\.xml$/.test(report)) {
    for (const match of text.matchAll(/<class\b[^>]*\bfilename="([^"]+)"[^>]*>([\s\S]*?)<\/class>/g)) {
      const hits = [...(match[2] ?? '').matchAll(/<line\b[^>]*\bhits="(\d+)"/g)]
      add(match[1] ?? '', hits.filter(line => Number(line[1]) > 0).length, hits.length)
    }
  } else {
    for (const line of text.split('\n')) {
      const match = /^(.+?):\d+\.\d+,\d+\.\d+ (\d+) (\d+)$/.exec(line.trim())
      if (match) add(match[1] ?? '', Number(match[3]) > 0 ? Number(match[2]) : 0, Number(match[2]))
    }
  }
  return coverage
}

// ---------------------------------------------------------------------------
// Deploys: which commit is live, from what the repository already knows

/** A deploy marker in the repository's own refs: a deploy branch, or a deploy or release tag. */
const DEPLOY_REF = /^refs\/(?:heads|remotes\/[^/]+)\/(production|prod|live|deploy|deployed)$|^refs\/tags\/(deploy|prod|production|live|release)([-_/.]|$)/i

/**
 * The newest deploy marker in `git for-each-ref` output (refname, object,
 * date per line, tab-separated): a branch named production, prod, live or
 * deploy, or a deploy or release tag. Null when the repository has none.
 */
export function deployRefOf(output: string): { ref: string; commit: string; at: string | null } | null {
  let best: { ref: string; commit: string; at: string | null } | null = null
  for (const line of output.split('\n')) {
    const [ref = '', commit = '', at = ''] = line.split('\t')
    if (!ref || !/^[0-9a-f]{7,40}$/.test(commit) || !DEPLOY_REF.test(ref)) continue
    if (best === null || Date.parse(at || '0') > Date.parse(best.at ?? '0')) best = { ref, commit, at: at || null }
  }
  return best
}

/**
 * The commit Railway is serving, from `railway status --json`: the newest
 * successful active deployment (else the latest one) whose metadata names a
 * commit. Deployment metadata, never a variable. Null when none does: a
 * database, a deploy uploaded with `railway up`, a format this doesn't know.
 */
export function railwayDeployOf(output: string): { commit: string; at: string | null } | null {
  let json: unknown
  try {
    json = JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1))
  } catch {
    return null
  }
  const found: { commit: string; at: string | null; active: boolean }[] = []
  const visit = (node: unknown, active: boolean | null): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item, active)
      return
    }
    if (typeof node !== 'object' || node === null) return
    const record = node as Record<string, unknown>
    if (active !== null && 'status' in record && 'meta' in record) {
      let meta = record.meta
      if (typeof meta === 'string') {
        try {
          meta = JSON.parse(meta)
        } catch {
          meta = null
        }
      }
      const commit = (meta as Record<string, unknown> | null)?.commitHash
      if (/^SUCCESS$/i.test(String(record.status)) && typeof commit === 'string' && /^[0-9a-f]{7,40}$/.test(commit)) {
        found.push({ commit, at: typeof record.createdAt === 'string' ? record.createdAt : null, active })
      }
    }
    for (const [key, value] of Object.entries(record)) visit(value, key === 'activeDeployments' ? true : key === 'latestDeployment' ? (active ?? false) : active)
  }
  visit(json, null)
  const pool = found.some(one => one.active) ? found.filter(one => one.active) : found
  const newest = pool.sort((a, b) => Date.parse(b.at ?? '0') - Date.parse(a.at ?? '0'))[0]
  return newest ? { commit: newest.commit, at: newest.at } : null
}

/** A commit hash a deployed app reports about itself, in a health answer: `{ "commit": "abc1234" }`. */
export function reportedCommit(body: string): string | null {
  const match = /"(?:commit|sha|git_sha|gitSha|git_commit|revision|version)"\s*:\s*"([0-9a-f]{7,40})"/i.exec(body)
  return match?.[1] ?? null
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
const MARKER = new RegExp(MARKER_PATTERN)

/** Lines carrying a marker word: what `git grep -c` counts. */
export const markerCount = (text: string) => text.split('\n').filter(line => MARKER.test(line)).length

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

/** Merged work: a pull request merged, squashed or a branch merged, on the main line. */
export type Merge = { at: string; hash: string; subject: string; pr: number | null; files: string[] }

/**
 * `git log --first-parent -m --name-only` in LOG_FORMAT as the merges in it:
 * "Merge pull request #12", a squash's "Title (#12)", "Merge branch 'x'".
 * Commits made straight on the main line aren't merged work.
 */
export function parseMerges(output: string): Merge[] {
  const merges: Merge[] = []
  let current: Merge | null = null
  for (const line of output.split('\n')) {
    if (line.startsWith('@@')) {
      const [at = '', hash = '', ...rest] = line.slice(2).split('\t')
      const subject = rest.join('\t').trim()
      const pr = /^Merge pull request #(\d+)/.exec(subject)?.[1] ?? /\(#(\d+)\)\s*$/.exec(subject)?.[1]
      const isMerge = pr !== undefined || /^Merge (branch|remote-tracking branch) /.test(subject)
      current = isMerge ? { at: at.trim(), hash, subject, pr: pr === undefined ? null : Number(pr), files: [] } : null
      if (current && !merges.some(merge => merge.hash === hash)) merges.push(current)
      continue
    }
    const path = line.trim()
    if (path && current && !current.files.includes(path)) current.files.push(path)
  }
  return merges
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

/**
 * The env names an EAS build profile sets in eas.json (following `extends`):
 * baked into the build as surely as EAS's own variables. Names only.
 */
export function easProfileNames(text: string, profile = 'production'): string[] {
  let json: { build?: Record<string, { env?: Record<string, unknown>; extends?: string }> }
  try {
    json = JSON.parse(text)
  } catch {
    return []
  }
  const names = new Set<string>()
  const seen = new Set<string>()
  for (let at: string | undefined = profile; at !== undefined && !seen.has(at); at = json.build?.[at]?.extends) {
    seen.add(at)
    for (const name of Object.keys(json.build?.[at]?.env ?? {})) if (/^[A-Z][A-Z0-9_]+$/.test(name)) names.add(name)
  }
  return [...names]
}

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
  /** A source file (not a test, not a doc): what "has code" counts. */
  code?: boolean
  /** Referenced from another non-test file (or routed by convention); null when that can't be read, and for tests and non-code. */
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
  /** The whole suite's last run: pass when every command passed, null when it hasn't run or couldn't. */
  suite?: 'pass' | 'fail' | null
  /** Share of its code's lines a coverage report saw run (0 to 1); null with no report, a stale one, or none of its files in it. */
  coverage?: number | null
  /** Its latest code is in the deployed commit; null when nothing says which commit is deployed. */
  live?: boolean | null
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
  /** match → files containing it, for every reference name of every feature file; null when nothing could be read. */
  references: ReadonlyMap<string, ReadonlySet<string>> | null
  /** False when not every file could be read (or the list itself was bounded): a name found nowhere is then unknown. */
  referencesComplete?: boolean
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
  /** Source file → tests calling a route its handler reaches (routeTestsOf). */
  routeTests?: ReadonlyMap<string, ReadonlySet<string>>
  /** Server files that render a page (rendersPage), for the server UI style. */
  pages?: ReadonlySet<string>
  /** The whole suite's last run. */
  suite?: 'pass' | 'fail' | null
  /** The project's coverage report and when it was written; null without one. */
  coverage?: { files: CoverageMap; atMs: number } | null
  /** The deployed commit and the files changed since; null when no deploy can be seen. */
  deploy?: { commit: string; changed: ReadonlySet<string> } | null
}

/** The label env presence carries when it came from the project's own .env files. */
export const LOCAL_ENV = 'local .env'

/** One host's answer about env var names: what a host check keeps (names only). */
export type HostNames = { kind: HostKind; label: string; side: 'server' | 'client' | 'both'; ok: boolean; names: readonly string[] }

/**
 * Which env names each side has, and where that was read. A deploy host that
 * couldn't be read leaves its side unknown: the local .env is only the answer
 * for a side no deploy host serves.
 */
export function envPresenceOf(checks: readonly HostNames[]): EnvPresence {
  const pick = (side: 'server' | 'client') => {
    const hosts = checks.filter(check => check.kind !== 'dotenv' && (check.side === side || check.side === 'both'))
    const host = hosts.find(check => check.ok) ?? (hosts.length > 0 ? null : checks.find(check => check.ok && check.kind === 'dotenv'))
    return host ? { source: host.label, names: new Set(host.names) } : null
  }
  return { server: pick('server'), client: pick('client') }
}

/**
 * The evidence for one feature: its files (`relatedFiles`) and the env vars the
 * code that configures it needs (`declaredConfig`, beyond what its files read).
 */
export function featureEvidence(relatedFiles: readonly string[], facts: ProjectFacts, declaredConfig: readonly string[] = []): FeatureEvidence {
  const files: FileEvidence[] = relatedFiles.map(path => {
    const exists = facts.files.has(path)
    const isCode = (isSourceFile(path) || UI_EXT.test(path)) && !isTestFile(path)
    let wired: boolean | null = null
    if (exists && isCode) {
      const references = facts.references
      const names = referenceNames(path)
      // Nothing read, no name a reference could be found by, or a read that missed files: unknown, never "not wired".
      const found =
        references !== null &&
        names.some(name => [...(references.get(name) ?? [])].some(other => moduleOf(other) !== moduleOf(path) && !isTestFile(other) && !isDocFile(other)))
      wired = isRoutedByConvention(path, facts.frameworks) || isToolConfig(path)
        ? true
        : references === null || names.length === 0
          ? null
          : found || (facts.referencesComplete === false ? null : false)
    }
    return {
      path,
      exists,
      code: isCode,
      wired,
      screen: exists && (isScreenFile(path, facts.frameworks) || (facts.pages?.has(path) ?? false)),
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

  // Coverage counts only when the report is newer than the feature's last change.
  const code = files.filter(file => file.exists && file.code)
  let coverage: number | null = null
  const report = facts.coverage
  if (report && code.length > 0 && (last === null || Date.parse(last) <= report.atMs)) {
    let hit = 0
    let total = 0
    for (const file of code) {
      const seen = report.files.get(file.path)
      if (seen) {
        hit += seen.hit
        total += seen.total
      }
    }
    coverage = total > 0 ? hit / total : null
  }
  const deploy = facts.deploy
  const live =
    deploy && code.length > 0 ? !relatedFiles.some(path => deploy.changed.has(path) || facts.uncommitted.has(path)) : null

  return {
    files,
    env_required: [...required].sort(),
    env_missing: missing.sort(),
    env_source: sources.size > 0 ? [...sources].join(', ') : null,
    tests,
    tests_status,
    suite: facts.suite ?? null,
    coverage,
    live,
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
