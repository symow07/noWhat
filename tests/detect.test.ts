import { describe, expect, test } from 'claude-code/testing'

import {
  type ProjectFacts,
  declaredNames,
  envNamesFrom,
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
  parseImportMatches,
  sourceNameCounts,
  testSubject,
  testsFor,
  unsortedFiles,
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
      { path: 'mobile/src/app/login.tsx', exists: true, wired: true, screen: true, markers: 0, last_change: null, uncommitted: true },
      { path: 'backend/src/lib/mailer.ts', exists: true, wired: true, screen: false, markers: 2, last_change: '2026-10-10T10:00:00Z', uncommitted: false },
      { path: 'backend/src/lib/unused.ts', exists: true, wired: false, screen: false, markers: 0, last_change: null, uncommitted: false },
      { path: 'backend/src/lib/gone.ts', exists: false, wired: null, screen: false, markers: 0, last_change: null, uncommitted: false },
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

    const testImports = parseImportMatches("mobile/src/lib/import-parser.test.ts:/import-parser'\n", ['import-parser'])
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
