import { describe, expect, test } from 'claude-code/testing'

import {
  type ProjectFacts,
  declaredNames,
  easProfileNames,
  envNamesFrom,
  envPresenceOf,
  envReads,
  featureEvidence,
  inventoryOf,
  isTestCommand,
  optionalInSchema,
  parseGitActivity,
  parseGrepMatches,
  parseTestRun,
  referenceNames,
  importNames,
  importPatterns,
  findImports,
  findReferences,
  sourceNameCounts,
  testSubject,
  testsFor,
  unsortedFiles,
  deployRefOf,
  mountsIn,
  parseCoverage,
  parseMerges,
  railwayDeployOf,
  rendersPage,
  reportedCommit,
  routeMatches,
  routeTestsOf,
  routesIn,
  uiStyleOf,
  urlsIn,
} from '../hooks/detect'

// Three repositories that share nothing: the detector must read each on its own terms.

const EXPO_MONOREPO = {
  files: [
    'backend/package.json',
    'backend/bun.lock',
    'backend/railway.json',
    'backend/src/index.ts',
    'backend/src/routes/auth.ts',
    'backend/src/lib/mailer.ts',
    'backend/src/lib/mailer.test.ts',
    'mobile/package.json',
    'mobile/bun.lock',
    'mobile/eas.json',
    'mobile/src/app/_layout.tsx',
    'mobile/src/app/(tabs)/index.tsx',
    'mobile/src/app/login.tsx',
    'mobile/src/components/Card.tsx',
    'README.md',
    'docs/plan.md',
  ],
  manifests: [
    { path: 'backend/package.json', text: JSON.stringify({ scripts: { test: 'bun test' }, dependencies: { hono: '4', '@prisma/client': '5' } }) },
    { path: 'mobile/package.json', text: JSON.stringify({ scripts: { test: 'bun test src' }, dependencies: { expo: '53', 'react-native': '0.79', react: '19' } }) },
  ],
}

const FLASK_APP = {
  files: ['requirements.txt', 'app.py', 'routes/billing.py', 'templates/index.html', 'templates/billing.html', 'tests/test_billing.py', 'fly.toml'],
  manifests: [{ path: 'requirements.txt', text: 'flask==3.0\nstripe\npytest\n' }],
}

const GO_SERVICE = {
  files: ['go.mod', 'cmd/server/main.go', 'internal/handlers/users.go', 'internal/handlers/users_test.go', 'internal/store/store.go'],
  manifests: [{ path: 'go.mod', text: 'module example.com/svc\n\nrequire github.com/gin-gonic/gin v1.10.0\n' }],
}

describe('inventory, on any stack', () => {
  test('an Expo app with a Bun backend', () => {
    const inventory = inventoryOf(EXPO_MONOREPO.files, EXPO_MONOREPO.manifests)
    expect(inventory.languages).toEqual(['TypeScript'])
    expect(inventory.frameworks).toEqual(expect.arrayContaining(['Hono', 'Prisma', 'Expo', 'React Native', 'React']))
    expect(inventory.screens).toEqual(['mobile/src/app/(tabs)/index.tsx', 'mobile/src/app/login.tsx'])
    expect(inventory.routes).toEqual(['backend/src/routes/auth.ts'])
    expect(inventory.tests).toEqual(['backend/src/lib/mailer.test.ts'])
    expect(inventory.testCommands).toEqual([
      { dir: 'backend', argv: ['bun', 'run', 'test'] },
      { dir: 'mobile', argv: ['bun', 'run', 'test'] },
    ])
    expect(inventory.hosts).toEqual(['railway', 'eas'])
    expect(inventory.docs).toEqual(['README.md', 'docs/plan.md'])
  })

  test('a Flask app on Fly', () => {
    const inventory = inventoryOf(FLASK_APP.files, FLASK_APP.manifests)
    expect(inventory.languages).toEqual(['Python'])
    expect(inventory.frameworks).toEqual(['Flask'])
    expect(inventory.screens).toEqual(['templates/index.html', 'templates/billing.html'])
    expect(inventory.routes).toEqual(['routes/billing.py'])
    expect(inventory.tests).toEqual(['tests/test_billing.py'])
    expect(inventory.testCommands).toEqual([{ dir: '', argv: ['python3', '-m', 'pytest', '-q'] }])
    expect(inventory.hosts).toEqual(['fly'])
  })

  test('a Go service', () => {
    const inventory = inventoryOf(GO_SERVICE.files, GO_SERVICE.manifests)
    expect(inventory.languages).toEqual(['Go'])
    expect(inventory.frameworks).toEqual(['Gin'])
    expect(inventory.routes).toEqual(['internal/handlers/users.go'])
    expect(inventory.tests).toEqual(['internal/handlers/users_test.go'])
    expect(inventory.testCommands).toEqual([{ dir: '', argv: ['go', 'test', './...'] }])
    expect(inventory.hosts).toEqual([])
  })

  test('a test script that is the npm placeholder runs nothing', () => {
    const inventory = inventoryOf(['package.json'], [{ path: 'package.json', text: JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) }])
    expect(inventory.testCommands).toEqual([])
  })
})

describe('configuration', () => {
  test('env reads across languages, with fallbacks and flags as optional', () => {
    const ts = `
      const key = process.env.OPENAI_API_KEY
      const port = process.env.PORT ?? 3000
      const google = env.GOOGLE_CLIENT_ID
      const pro = process.env.DEV_PRO_OVERRIDE === "1"
      const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN || undefined`
    expect(envReads(ts)).toEqual([
      { name: 'OPENAI_API_KEY', optional: false },
      { name: 'PORT', optional: true },
      { name: 'DEV_PRO_OVERRIDE', optional: true },
      { name: 'EXPO_PUBLIC_SENTRY_DSN', optional: true },
      { name: 'GOOGLE_CLIENT_ID', optional: false },
    ])
    expect(envReads('stripe.api_key = os.getenv("STRIPE_KEY")\ndebug = os.getenv("DEBUG", "0")')).toEqual([
      { name: 'STRIPE_KEY', optional: false },
      { name: 'DEBUG', optional: true },
    ])
    expect(envReads('dsn := os.Getenv("DATABASE_URL")')).toEqual([{ name: 'DATABASE_URL', optional: false }])
    expect(envReads('secret = ENV.fetch("SECRET_KEY_BASE")\nhost = ENV["APP_HOST"] || "localhost"')).toEqual([
      { name: 'SECRET_KEY_BASE', optional: false },
      { name: 'APP_HOST', optional: true },
    ])
  })

  test('an env schema: only a real default makes a name optional; every name is declared', () => {
    const schema = `export const env = z.object({\n  OPENAI_API_KEY: z.string(),\n  SENTRY_DSN: z.string().optional(),\n  LOG_LEVEL: z.string().default("info"),\n})`
    // A bare .optional() boots without the key, but the feature that reads it is off: still needed.
    expect([...optionalInSchema(schema)]).toEqual(['LOG_LEVEL'])
    expect(declaredNames(schema)).toEqual(['OPENAI_API_KEY', 'SENTRY_DSN', 'LOG_LEVEL'])
    expect(declaredNames('# keys\nSTRIPE_KEY=\nexport PUBLIC_URL=http://x\n')).toEqual(['STRIPE_KEY', 'PUBLIC_URL'])
  })

  test("host output becomes names, never values", () => {
    expect(envNamesFrom(JSON.stringify({ DATABASE_URL: 'postgres://secret', OPENAI_API_KEY: 'sk-secret' }), 'railway')).toEqual([
      'DATABASE_URL',
      'OPENAI_API_KEY',
    ])
    expect(envNamesFrom('\n\nEnvironment: production\nEXPO_PUBLIC_SENTRY_DSN=https://x\nSENTRY_AUTH_TOKEN=*****\n', 'eas')).toEqual([
      'EXPO_PUBLIC_SENTRY_DSN',
      'SENTRY_AUTH_TOKEN',
    ])
    expect(envNamesFrom(JSON.stringify([{ Name: 'STRIPE_KEY', Digest: 'abc' }]), 'fly')).toEqual(['STRIPE_KEY'])
    expect(envNamesFrom('# comment\nexport API_URL=http://x\nNEXT_PUBLIC_KEY=1\n', 'dotenv')).toEqual(['API_URL', 'NEXT_PUBLIC_KEY'])
  })
})

describe('where env names are read', () => {
  const host = (kind: 'railway' | 'eas' | 'dotenv', ok: boolean, names: string[], side: 'server' | 'client' | 'both' = 'server') => ({
    kind,
    label: kind === 'dotenv' ? 'local .env' : kind,
    side,
    ok,
    names,
  })

  test("a deploy host that couldn't be read is unknown: the local .env doesn't stand in for it", () => {
    const local = host('dotenv', true, ['DATABASE_URL'], 'both')
    expect(envPresenceOf([host('railway', false, []), local]).server).toBeNull()
    expect(envPresenceOf([host('railway', true, ['LLM_API_KEY']), local]).server?.source).toBe('railway')
    // With no deploy host at all, the .env is where the keys live.
    expect(envPresenceOf([local]).server?.source).toBe('local .env')
  })

  test("an EAS build profile's env counts, extends followed; names only", () => {
    const eas = JSON.stringify({ build: { base: { env: { EXPO_PUBLIC_API_URL: 'https://x' } }, production: { extends: 'base', env: { EXPO_PUBLIC_SENTRY_ENV: 'prod' } } } })
    expect(easProfileNames(eas).sort()).toEqual(['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_SENTRY_ENV'])
    expect(easProfileNames('not json')).toEqual([])
  })
})

describe('wiring, activity and tests', () => {
  test('reference names are specific when a file name is common', () => {
    expect(referenceNames('mobile/src/lib/note-search.ts')).toEqual(['note-search'])
    expect(referenceNames('mobile/src/lib/sync/engine.ts')).toEqual(['sync/engine', './engine'])
    expect(referenceNames('backend/src/lib/email-parse/index.ts')).toEqual(['email-parse'])
    expect(referenceNames('internal/handlers/users.go')).toEqual(['users'])
    // A short name is searched as its import path, so "me" doesn't match every "me" in the repo.
    expect(referenceNames('backend/src/routes/me.ts')).toEqual(['routes/me', './me'])
  })

  test('git output parses', () => {
    const matches = parseGrepMatches('a.ts:mailer\nb.ts:mailer\nc.ts:auth\n')
    expect([...(matches.get('mailer') ?? [])]).toEqual(['a.ts', 'b.ts'])
    const activity = parseGitActivity('@@2026-10-10T10:00:00+00:00\na.ts\nb.ts\n\n@@2026-08-01T10:00:00+00:00\na.ts\n', Date.parse('2026-10-12T00:00:00Z'))
    expect(activity.get('a.ts')).toEqual({ last: '2026-10-10T10:00:00+00:00', recent: 1 })
  })

  test('test commands are recognised by their runner', () => {
    for (const command of ['bun test src', 'npm test', 'pnpm run test', 'npx vitest run', 'python3 -m pytest -q', 'go test ./...', 'cargo test', 'bundle exec rspec']) {
      expect(isTestCommand(command)).toBe(true)
    }
    expect(isTestCommand('git status')).toBe(false)
  })

  test('a run names its failing files, in the formats runners print', () => {
    const known = ['mobile/src/lib/a.test.ts', 'mobile/src/lib/b.test.ts']
    const bun = 'src/lib/a.test.ts:\n(pass) adds\n(fail) subtracts\nsrc/lib/b.test.ts:\n(pass) multiplies\n\n 2 pass\n 1 fail\n'
    expect(parseTestRun(bun, known, false)).toEqual({ ok: false, failing: ['mobile/src/lib/a.test.ts'], passing: ['mobile/src/lib/b.test.ts'] })
    const jest = 'PASS src/lib/b.test.ts\nFAIL src/lib/a.test.ts\n  ● subtracts\nTests: 1 failed, 2 passed\n'
    expect(parseTestRun(jest, known, false).failing).toEqual(['mobile/src/lib/a.test.ts'])
    const pytest = 'FAILED tests/test_billing.py::test_refund - assert 1 == 2\n1 failed, 3 passed'
    expect(parseTestRun(pytest, ['tests/test_billing.py'], false).failing).toEqual(['tests/test_billing.py'])
    const go = '--- FAIL: TestCreate (0.00s)\n    users_test.go:14: want 201, got 500\nFAIL\texample.com/svc/internal/handlers\t0.01s'
    expect(parseTestRun(go, ['internal/handlers/users_test.go'], false).failing).toEqual(['internal/handlers/users_test.go'])
    expect(parseTestRun('all good', known, true)).toEqual({ ok: true, failing: [], passing: [] })
  })
})

describe("one feature's evidence", () => {
  const facts: ProjectFacts = {
    frameworks: ['Expo'],
    files: new Set([...EXPO_MONOREPO.files, 'backend/src/lib/unused.ts', 'backend/src/lib/unused.test.ts']),
    references: new Map([
      ['mailer', new Set(['backend/src/routes/auth.ts', 'backend/src/lib/mailer.test.ts'])],
      ['unused', new Set(['backend/src/lib/unused.test.ts'])],
    ]),
    testImports: new Map(),
    markers: new Map([['backend/src/lib/mailer.ts', 2]]),
    activity: new Map([['backend/src/lib/mailer.ts', { last: '2026-10-10T10:00:00Z', recent: 3 }]]),
    commits: new Map([
      ['backend/src/lib/mailer.ts', [{ hash: 'b2', at: '2026-10-10T10:00:00Z', subject: 'mailer retries' }, { hash: 'a1', at: '2026-10-01T10:00:00Z', subject: 'add mailer' }]],
      ['mobile/src/app/login.tsx', [{ hash: 'a1', at: '2026-10-01T10:00:00Z', subject: 'add mailer' }]],
    ]),
    uncommitted: new Set(['mobile/src/app/login.tsx']),
    envReads: new Map([
      ['backend/src/lib/mailer.ts', [{ name: 'RESEND_API_KEY', optional: false }, { name: 'PORT', optional: false }]],
      ['mobile/src/app/login.tsx', [{ name: 'EXPO_PUBLIC_AUTH_URL', optional: false }]],
    ]),
    env: { server: { source: 'Railway (production)', names: new Set(['DATABASE_URL']) }, client: null },
    testResults: { 'backend/src/lib/mailer.test.ts': { ok: true, at: '2026-10-12T00:00:00Z' } },
  }

  test('wired, tests, config, activity', () => {
    const ev = featureEvidence(['mobile/src/app/login.tsx', 'backend/src/lib/mailer.ts', 'backend/src/lib/unused.ts', 'backend/src/lib/gone.ts'], facts)
    expect(ev.files).toEqual([
      { path: 'mobile/src/app/login.tsx', exists: true, code: true, wired: true, screen: true, markers: 0, last_change: null, uncommitted: true },
      { path: 'backend/src/lib/mailer.ts', exists: true, code: true, wired: true, screen: false, markers: 2, last_change: '2026-10-10T10:00:00Z', uncommitted: false },
      { path: 'backend/src/lib/unused.ts', exists: true, code: true, wired: false, screen: false, markers: 0, last_change: null, uncommitted: false },
      { path: 'backend/src/lib/gone.ts', exists: false, code: true, wired: null, screen: false, markers: 0, last_change: null, uncommitted: false },
    ])
    // A commit that touched two of its files is listed once, newest first.
    expect(ev.commits.map(commit => commit.hash)).toEqual(['b2', 'a1'])
    // PORT is the platform's; the client var has no client host to be checked against.
    expect(ev.env_required).toEqual(['EXPO_PUBLIC_AUTH_URL', 'RESEND_API_KEY'])
    expect(ev.env_missing).toEqual(['RESEND_API_KEY'])
    expect(ev.env_source).toBe('Railway (production)')
    expect(ev.tests).toEqual(['backend/src/lib/mailer.test.ts', 'backend/src/lib/unused.test.ts'])
    expect(ev.tests_status).toBe('pass')
    expect(ev.last_change).toBe('2026-10-10T10:00:00Z')
    expect(ev.uncommitted).toBe(true)
  })

  test('config a shared module reads counts when the feature declares it', () => {
    const ev = featureEvidence(['mobile/src/app/login.tsx'], facts, ['GOOGLE_CLIENT_ID', 'PORT'])
    expect(ev.env_required).toEqual(['EXPO_PUBLIC_AUTH_URL', 'GOOGLE_CLIENT_ID'])
    expect(ev.env_missing).toEqual(['GOOGLE_CLIENT_ID'])
  })

  test('a test counts for a file it is named for or imports by path, never for a word it happens to contain', () => {
    const files = new Set([
      'mobile/src/app/import.tsx',
      'mobile/src/app/(tabs)/settings.tsx',
      'mobile/src/lib/settings.ts',
      'mobile/src/lib/settings.test.ts',
      'mobile/src/lib/import-parser.ts',
      'mobile/src/lib/import-parser.test.ts',
      'mobile/src/app/__tests__/import.test.tsx',
      'backend/src/routes/me.ts',
      'backend/src/routes/me.route.test.ts',
      'backend/src/lib/db.ts',
      'backend/src/db.test.ts',
      'tests/test_billing.py',
      'app/billing.py',
    ])
    const counts = sourceNameCounts(files)
    // "settings" names two files, so a test has to reach this one by its folder.
    expect(importNames('mobile/src/app/(tabs)/settings.tsx', counts)).toEqual(['(tabs)/settings'])
    expect(importNames('mobile/src/app/import.tsx', counts)).toEqual(['import'])
    expect(importPatterns('import')).toContain("/import'")

    const testImports = findImports([['mobile/src/lib/import-parser.test.ts', "import { parse } from '../lib/import-parser'\n"]], ['import-parser'])
    const facts = { files, testImports }
    // Every test says "import"; only the one named for the screen counts.
    expect(testsFor('mobile/src/app/import.tsx', facts)).toEqual(['mobile/src/app/__tests__/import.test.tsx'])
    expect(testsFor('mobile/src/lib/import-parser.ts', facts)).toEqual(['mobile/src/lib/import-parser.test.ts'])
    // The settings screen has no test of its own; lib/settings.test.ts is the other settings'.
    expect(testsFor('mobile/src/app/(tabs)/settings.tsx', facts)).toEqual([])
    expect(testsFor('mobile/src/lib/settings.ts', facts)).toEqual(['mobile/src/lib/settings.test.ts'])
    expect(testsFor('backend/src/routes/me.ts', facts)).toEqual(['backend/src/routes/me.route.test.ts'])
    // A unique name is found wherever its test lives, as Python keeps tests apart.
    expect(testsFor('app/billing.py', facts)).toEqual(['tests/test_billing.py'])
    expect(testSubject('internal/handlers/users_test.go')).toBe('users')
    expect(testSubject('Sources/AppTests/UserStoreTests.swift')).toBe('UserStore')
    expect(testSubject('src/lib/email-parse/__tests__/index.test.ts')).toBe('email-parse')
  })

  test('without git, wiring is unknown rather than missing', () => {
    const ev = featureEvidence(['backend/src/lib/mailer.ts'], { ...facts, references: null })
    expect(ev.files[0]?.wired).toBeNull()
  })
})

describe('unsorted files', () => {
  test('new source files no feature claims, minus tests, docs, dependencies and what a sort left out', () => {
    const existing = new Set([
      'src/export/csv.ts',
      'src/export/csv.test.ts',
      'src/auth/login.ts',
      'src/ui/button.tsx',
      'docs/plan.md',
      'node_modules/x/index.js',
      'scripts/seed.ts',
      'package.json',
    ])
    const candidates = [...existing, 'src/deleted.ts', ' src/export/csv.ts ']
    expect(unsortedFiles(candidates, ['src/auth/', 'src/ui/button.tsx'], ['scripts/'], existing)).toEqual(['src/export/csv.ts'])
  })
})

describe('the one-pass scan', () => {
  test('whole-word references, as git grep -w finds them, in any number of files', () => {
    const texts: [string, string][] = [
      ['src/app.ts', "import { send } from './lib/mailer.js'\nimport { run } from './sync/engine'\n"],
      ['src/other.ts', 'const mailers = []; // not the mailer module? it is: mailer\n'],
      ['src/notes.ts', 'engineering notes'],
    ]
    const found = findReferences(texts, ['mailer', 'sync/engine', './engine'])
    expect([...(found.get('mailer') ?? [])]).toEqual(['src/app.ts', 'src/other.ts'])
    expect([...(found.get('sync/engine') ?? [])]).toEqual(['src/app.ts'])
    // "engineering" is not "./engine".
    expect(found.get('./engine')).toBeUndefined()
  })

  test('test imports by path, with an ESM extension, and Python modules', () => {
    const texts: [string, string][] = [
      ['tests/integration/orders.test.ts', "const { renderOrders } = await import('../../src/web/orders.js')"],
      ['tests/test_billing.py', 'from app.billing import refund\n'],
      ['tests/unrelated.test.ts', "it('orders things', () => {})"],
    ]
    const found = findImports(texts, ['orders', 'billing'])
    expect([...(found.get('orders') ?? [])]).toEqual(['tests/integration/orders.test.ts'])
    expect([...(found.get('billing') ?? [])]).toEqual(['tests/test_billing.py'])
  })
})

describe('a server that renders its own pages', () => {
  const page = (title: string) =>
    `export function render${title}(rows: Row[]) {\n  return \`<main><h1>${title}</h1><form method="post"><label>Name</label><input name="n"><button>Save</button></form><ul>\${rows.map(r => \`<li>\${r.name}</li>\`).join('')}</ul></main>\`\n}\n`

  test('the UI style comes first: components, native, or server pages', () => {
    expect(uiStyleOf(['Expo', 'React Native', 'React'], ['app/index.tsx'])).toBe('components')
    expect(uiStyleOf(['Fastify'], ['src/web/orders.ts'])).toBe('server')
    expect(uiStyleOf(['Flask'], ['app.py', 'templates/index.html'])).toBe('server')
    expect(uiStyleOf(['Xcode'], ['App/HomeView.swift'])).toBe('native')
  })

  test('a page is a server file with a page of markup, a document, or a template render', () => {
    expect(rendersPage('src/web/orders.ts', page('Orders'))).toBe(true)
    expect(rendersPage('src/web/layout.ts', 'export const layout = (body: string) => `<!doctype html><html><body>${body}</body></html>`')).toBe(true)
    expect(rendersPage('app/views.py', 'return render_template("billing.html", invoices=invoices)')).toBe(true)
    // An API answering JSON, a one-line snippet, and a test are not pages.
    expect(rendersPage('src/api/orders.ts', 'reply.send({ orders })')).toBe(false)
    expect(rendersPage('src/mail.ts', 'const footer = `<p>Thanks</p>`')).toBe(false)
    expect(rendersPage('tests/orders.test.ts', page('Orders'))).toBe(false)
  })

  test("routes and their handlers: the modules a route's handler calls into", () => {
    const files = new Set(['src/web/app.ts', 'src/web/orders.ts', 'src/web/layout.ts', 'src/core/orders-store.ts', 'src/web/admin.ts'])
    const app = [
      "import { renderOrders, renderOrder } from './orders.js'",
      "import { layout } from './layout.js'",
      "import * as store from '../core/orders-store.js'",
      "import admin from './admin.js'",
      "app.get('/app/orders', async (req, reply) => reply.type('text/html').send(layout(renderOrders(await store.list()))))",
      "app.get('/app/orders/:id', async (req, reply) => reply.send(layout(renderOrder(await store.one(req.params.id)))))",
      "app.post('/health', async () => ({ ok: true }))",
      "app.register(admin, { prefix: '/admin' })",
    ].join('\n')
    const routes = routesIn('src/web/app.ts', app, files)
    expect(routes.map(route => route.path)).toEqual(['/app/orders', '/app/orders/:id', '/health'])
    expect(routes[0]?.handlers.sort()).toEqual(['src/core/orders-store.ts', 'src/web/layout.ts', 'src/web/orders.ts'])
    expect(routes[2]?.handlers).toEqual([])
    expect([...mountsIn('src/web/app.ts', app, files)]).toEqual([['src/web/admin.ts', ['/admin']]])
    expect(routesIn('app/views.py', '@app.get("/billing")\ndef billing():\n    return render_template("billing.html")\n', new Set(['app/views.py']))[0]?.path).toBe('/billing')
  })

  test('the URLs a test calls, and which routes answer them', () => {
    const text = "await app.inject({ method: 'GET', url: '/app/orders?page=2' })\nawait app.inject({ url: `/app/orders/${id}` })\nconst parts = path.split('/')\n"
    expect(urlsIn(text)).toEqual(['/app/orders', '/app/orders/:param'])
    expect(routeMatches('/app/orders/:id', '/app/orders/:param')).toBe(true)
    expect(routeMatches('/app/orders/:id', '/app/orders/42')).toBe(true)
    // A parameter in the test only matches a parameter in the route.
    expect(routeMatches('/app/orders/archive', '/app/orders/:param')).toBe(false)
    expect(routeMatches('/p/{slug}', '/p/hello')).toBe(true)
  })

  test("an integration test maps to the module its route's handler calls, plumbing left out", () => {
    const route = (path: string, handlers: string[]) => ({ path, file: 'src/web/app.ts', handlers })
    const routes = [
      route('/app/orders', ['src/web/orders.ts', 'src/web/layout.ts']),
      route('/app/orders/:id', ['src/web/orders.ts', 'src/web/layout.ts']),
      route('/app/inbox', ['src/web/inbox.ts', 'src/web/layout.ts']),
      route('/app/team', ['src/web/team.ts', 'src/web/layout.ts']),
      route('/login', ['src/web/login.ts', 'src/web/layout.ts']),
      route('/settings', ['src/web/settings.ts', 'src/web/layout.ts']),
      route('/health', []),
    ]
    const tests: [string, string][] = [
      ['tests/integration/orders.test.ts', "app.inject({ url: '/app/orders' }); app.inject({ url: `/app/orders/${id}` })"],
      ['tests/integration/health.test.ts', "app.inject({ url: '/health' })"],
    ]
    const mapped = routeTestsOf(routes, new Map(), tests)
    expect([...(mapped.get('src/web/orders.ts') ?? [])]).toEqual(['tests/integration/orders.test.ts'])
    // The layout serves every page: it isn't what a test of one page checks.
    expect(mapped.get('src/web/layout.ts')).toBeUndefined()
    // A handler that calls nothing imported is the registering file's own.
    expect([...(mapped.get('src/web/app.ts') ?? [])]).toEqual(['tests/integration/health.test.ts'])
  })
})

describe('coverage, deploys and merges', () => {
  const files = new Set(['src/web/orders.ts', 'src/core/store.ts', 'internal/users.go'])

  test('coverage reports in the common formats, as repository paths', () => {
    const lcov = 'SF:src/web/orders.ts\nDA:1,3\nDA:2,0\nend_of_record\nSF:/elsewhere/x.ts\nDA:1,1\nend_of_record\n'
    expect([...parseCoverage('coverage/lcov.info', lcov, '/work/shop', files)]).toEqual([['src/web/orders.ts', { hit: 1, total: 2 }]])
    const istanbul = JSON.stringify({ '/work/shop/src/core/store.ts': { s: { 0: 2, 1: 0, 2: 5 } } })
    expect(parseCoverage('coverage/coverage-final.json', istanbul, '/work/shop', files).get('src/core/store.ts')).toEqual({ hit: 2, total: 3 })
    const cobertura = '<class name="x" filename="src/web/orders.ts"><lines><line number="1" hits="0"/><line number="2" hits="4"/></lines></class>'
    expect(parseCoverage('coverage.xml', cobertura, '/work/shop', files).get('src/web/orders.ts')).toEqual({ hit: 1, total: 2 })
    const go = 'mode: set\nexample.com/svc/internal/users.go:10.2,12.3 2 1\nexample.com/svc/internal/users.go:14.2,15.3 3 0\n'
    expect(parseCoverage('coverage.out', go, '/work/svc', files).get('internal/users.go')).toEqual({ hit: 2, total: 5 })
  })

  test('which commit is deployed: a deploy branch or tag, or what the app reports', () => {
    const refs = [
      'refs/heads/main\taaaaaaa1\t2026-10-20T10:00:00+00:00',
      'refs/remotes/origin/production\tbbbbbbb2\t2026-10-14T10:00:00+00:00',
      'refs/tags/v1.2.0\tccccccc3\t2026-10-18T10:00:00+00:00',
      'refs/tags/deploy-2026-10-16\tddddddd4\t2026-10-16T10:00:00+00:00',
    ].join('\n')
    expect(deployRefOf(refs)).toEqual({ ref: 'refs/tags/deploy-2026-10-16', commit: 'ddddddd4', at: '2026-10-16T10:00:00+00:00' })
    expect(deployRefOf('refs/heads/main\taaaaaaa1\t2026-10-20T10:00:00+00:00')).toBeNull()
    expect(reportedCommit('{"ok":true,"commit":"9f8e7d6c"}')).toBe('9f8e7d6c')
    // Railway: the serving deployment's metadata; a database has none, a failed build doesn't count.
    const status = JSON.stringify({
      environments: [
        {
          name: 'production',
          serviceInstances: [
            { serviceName: 'web', latestDeployment: { status: 'FAILED', createdAt: '2026-10-20T10:00:00Z', meta: { commitHash: 'eeeeeee5' } }, activeDeployments: [{ status: 'SUCCESS', createdAt: '2026-10-14T10:00:00Z', meta: { commitHash: 'abc1234' } }] },
            { serviceName: 'postgres', latestDeployment: { status: 'SUCCESS', createdAt: '2026-10-01T10:00:00Z', meta: { image: 'postgres:16' } } },
          ],
        },
      ],
    })
    expect(railwayDeployOf(`Railway CLI\n${status}\n`)).toEqual({ commit: 'abc1234', at: '2026-10-14T10:00:00Z' })
    expect(railwayDeployOf(JSON.stringify({ latestDeployment: { status: 'SUCCESS', meta: JSON.stringify({ commitHash: 'fff0001' }) } }))).toEqual({ commit: 'fff0001', at: null })
    expect(railwayDeployOf('{"project":{"name":"x"}}')).toBeNull()
    expect(railwayDeployOf('not json')).toBeNull()
    expect(reportedCommit('ok')).toBeNull()
  })

  test('merged pull requests, squashed or not; direct commits are not merges', () => {
    const log = [
      '@@2026-10-22T10:00:00+00:00\tabc1234\tMerge pull request #382 from someone/orders',
      'src/web/orders.ts',
      'src/core/store.ts',
      '@@2026-10-21T10:00:00+00:00\tdef5678\tOrders page (#381)',
      'src/web/orders.ts',
      '@@2026-10-20T10:00:00+00:00\t0123abc\tfix typo',
      'README.md',
    ].join('\n')
    expect(parseMerges(log).map(merge => [merge.pr, merge.files])).toEqual([
      [382, ['src/web/orders.ts', 'src/core/store.ts']],
      [381, ['src/web/orders.ts']],
    ])
  })
})

describe('unknown is not zero', () => {
  const base: ProjectFacts = {
    frameworks: ['Fastify'],
    files: new Set(['src/web/orders.ts', 'src/web/app.ts']),
    references: new Map(),
    testImports: new Map(),
    markers: new Map(),
    activity: new Map([['src/web/orders.ts', { last: '2026-10-10T00:00:00Z', recent: 1 }]]),
    commits: new Map(),
    uncommitted: new Set(),
    envReads: new Map(),
    env: { server: null, client: null },
    testResults: {},
  }

  test('a file nobody could fully check is unknown, never unwired', () => {
    expect(featureEvidence(['src/web/orders.ts'], base).files[0]?.wired).toBe(false)
    expect(featureEvidence(['src/web/orders.ts'], { ...base, referencesComplete: false }).files[0]?.wired).toBeNull()
  })

  test('a server page is a screen; live and coverage say so only when they can', () => {
    const ev = featureEvidence(['src/web/orders.ts'], { ...base, pages: new Set(['src/web/orders.ts']) })
    expect(ev.files[0]).toMatchObject({ screen: true, code: true })
    expect([ev.live, ev.coverage, ev.suite]).toEqual([null, null, null])
    const deployed = featureEvidence(['src/web/orders.ts'], { ...base, deploy: { commit: 'abc1234', changed: new Set(['src/web/orders.ts']) } })
    expect(deployed.live).toBe(false)
    expect(featureEvidence(['src/web/orders.ts'], { ...base, deploy: { commit: 'abc1234', changed: new Set() } }).live).toBe(true)
    // A report older than the feature's last change says nothing about it.
    const report = { files: new Map([['src/web/orders.ts', { hit: 3, total: 4 }]]), atMs: Date.parse('2026-10-12T00:00:00Z') }
    expect(featureEvidence(['src/web/orders.ts'], { ...base, coverage: report }).coverage).toBe(0.75)
    expect(featureEvidence(['src/web/orders.ts'], { ...base, coverage: { ...report, atMs: Date.parse('2026-10-01T00:00:00Z') } }).coverage).toBeNull()
  })
})
