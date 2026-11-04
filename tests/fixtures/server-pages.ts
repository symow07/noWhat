// Plotline: a made-up community-garden booking site, shaped like the projects
// whose screens are server code. Fastify route handlers return HTML built in
// template strings (no components, no JSX); integration tests call URLs and
// import only the app; it has a deploy host but has never been deployed.
// Used by server-pages.test.ts through the real plugin, never on disk.

/** Pages: the module, the function that renders it, the core module it reads, its route. */
const PAGES: { name: string; render: string; core: string | null; route: string }[] = [
  { name: 'plots', render: 'renderPlots', core: 'plots', route: '/plots' },
  { name: 'bookings', render: 'renderBookings', core: 'bookings', route: '/bookings' },
  { name: 'members', render: 'renderMembers', core: 'members', route: '/members' },
  { name: 'waitlist', render: 'renderWaitlist', core: 'members', route: '/waitlist' },
  { name: 'invoices', render: 'renderInvoices', core: 'invoices', route: '/invoices' },
  { name: 'reports', render: 'renderReports', core: 'invoices', route: '/reports' },
  { name: 'calendar', render: 'renderCalendar', core: 'bookings', route: '/calendar' },
  { name: 'notices', render: 'renderNotices', core: null, route: '/notices' },
  { name: 'login', render: 'renderLogin', core: 'members', route: '/login' },
  { name: 'signup', render: 'renderSignup', core: 'members', route: '/signup' },
  { name: 'settings', render: 'renderSettings', core: null, route: '/settings' },
  { name: 'admin', render: 'renderAdmin', core: 'store', route: '/admin' },
]

const page = ({ name, render, core }: (typeof PAGES)[number]) =>
  [
    "import { t } from '../i18n/messages.js'",
    core ? `import { list } from '../core/${core}.js'` : '',
    '',
    `export async function ${render}(): Promise<string> {`,
    core ? '  const rows = await list()' : '  const rows: { name: string }[] = []',
    '  return `<main>',
    `    <h1>\${t('${name}.title')}</h1>`,
    '    <table>${rows.map(row => `<tr><td>${row.name}</td></tr>`).join(\'\')}</table>',
    `    <form method="post" action="/${name}">`,
    `      <label>\${t('${name}.field')}</label><input name="name">`,
    `      <button>\${t('save')}</button>`,
    '    </form>',
    '  </main>`',
    '}',
    '',
  ].join('\n')

const core = (name: string) =>
  [
    "import { db } from './store.js'",
    '',
    `export async function list(): Promise<{ name: string }[]> {`,
    `  return db.all('${name}')`,
    '}',
    '',
    `export async function create(fields: { name: string }) {`,
    `  return db.insert('${name}', fields)`,
    '}',
    '',
  ].join('\n')

const app = [
  "import type { FastifyInstance } from 'fastify'",
  "import { layout } from './layout.js'",
  "import { t } from '../i18n/messages.js'",
  "import { create as createBooking } from '../core/bookings.js'",
  ...PAGES.map(one => `import { ${one.render} } from './${one.name}.js'`),
  '',
  'export function registerWeb(app: FastifyInstance) {',
  ...PAGES.map(one => `  app.get('${one.route}', async (req, reply) => reply.type('text/html').send(layout(t('${one.name}.title'), await ${one.render}())))`),
  "  app.get('/bookings/:id', async (req, reply) => reply.type('text/html').send(layout(t('bookings.title'), await renderBookings())))",
  "  app.post('/bookings', async (req, reply) => { await createBooking(req.body as { name: string }); return reply.redirect('/bookings') })",
  "  app.get('/health', async () => ({ ok: true }))",
  '}',
  '',
].join('\n')

const test = (title: string, lines: string[]) =>
  ["import { describe, expect, it } from 'vitest'", "import Fastify from 'fastify'", '', `describe('${title}', () => {`, ...lines.map(line => `  ${line}`), '})', ''].join('\n')

const integration = (title: string, calls: string[]) =>
  test(title, [
    'it(`answers`, async () => {',
    "  const { registerWeb } = await import('../../src/web/app.js')",
    '  const app = Fastify()',
    '  registerWeb(app)',
    ...calls.map(call => `  expect((await app.inject(${call})).statusCode).toBeLessThan(400)`),
    '})',
  ])

/** Every file of the project, by path. */
export const SERVER_APP: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'plotline', type: 'module', scripts: { test: 'vitest run' }, dependencies: { fastify: '5.0.0' }, devDependencies: { vitest: '2.1.0' } }, null, 2),
  'package-lock.json': '{}',
  'railway.json': JSON.stringify({ deploy: { startCommand: 'node dist/main.js' } }),
  'README.md': '# Plotline\n\nBook a plot in the community garden.\n',
  'src/main.ts': "import Fastify from 'fastify'\nimport { registerWeb } from './web/app.js'\n\nconst app = Fastify()\nregisterWeb(app)\nawait app.listen({ port: Number(process.env.PORT ?? 3000) })\n",
  'src/web/app.ts': app,
  'src/web/layout.ts': 'export const layout = (title: string, body: string) =>\n  `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`\n',
  ...Object.fromEntries(PAGES.map(one => [`src/web/${one.name}.ts`, page(one)])),
  'src/core/store.ts': "export const db = {\n  all: async (table: string) => [{ name: table }],\n  insert: async (table: string, fields: object) => ({ table, ...fields }),\n}\nexport async function list() {\n  return db.all('admin')\n}\n",
  'src/core/plots.ts': core('plots'),
  'src/core/bookings.ts': core('bookings'),
  'src/core/members.ts': core('members'),
  'src/core/invoices.ts': core('invoices'),
  'src/i18n/messages.ts': `const messages: Record<string, string> = {\n${PAGES.map(one => `  '${one.name}.title': '${one.name}',\n  '${one.name}.field': 'Name',`).join('\n')}\n  save: 'Save',\n}\nexport const t = (key: string) => messages[key] ?? key\n`,
  'tests/unit/plots.test.ts': test('plots', ["it('lists', async () => {", "  const { list } = await import('../../src/core/plots.js')", '  expect(await list()).toHaveLength(1)', '})']),
  'tests/unit/invoices.test.ts': test('invoices', ["it('creates', async () => {", "  const { create } = await import('../../src/core/invoices.js')", "  expect(await create({ name: 'March' })).toMatchObject({ name: 'March' })", '})']),
  'tests/integration/bookings.test.ts': integration('bookings', ["{ method: 'GET', url: '/bookings' }", "{ method: 'POST', url: '/bookings', payload: { name: 'Bed 4' } }", "{ url: `/bookings/${42}` }"]),
  'tests/integration/members.test.ts': integration('members', ["{ url: '/members' }", "{ url: '/waitlist' }"]),
  'tests/integration/calendar.test.ts': integration('calendar', ["{ url: `/calendar?week=${3}` }"]),
  'tests/integration/auth.test.ts': integration('auth', ["{ url: '/login' }", "{ method: 'GET', url: '/signup' }"]),
  'tests/integration/smoke.test.ts': integration('smoke', ["{ url: '/health' }"]),
  'tests/helpers/fake-store.ts': "export const fakeStore = { all: async () => [] }\n",
}

/** How Claude groups it at setup: files for the code, a status only for the two blockers with no code. */
export const SERVER_FEATURES = [
  { id: 'plots', title: 'Plots', kind: 'ui', related_files: ['src/web/plots.ts', 'src/core/plots.ts'] },
  { id: 'bookings', title: 'Bookings', kind: 'ui', milestone: 'season-2', related_files: ['src/web/bookings.ts', 'src/core/bookings.ts'] },
  { id: 'members', title: 'Members', kind: 'ui', related_files: ['src/web/members.ts', 'src/core/members.ts'] },
  { id: 'waitlist', title: 'Waitlist', kind: 'ui', milestone: 'season-2', related_files: ['src/web/waitlist.ts'] },
  { id: 'invoices', title: 'Invoices', kind: 'ui', milestone: 'season-2', related_files: ['src/web/invoices.ts', 'src/core/invoices.ts'] },
  { id: 'reports', title: 'Reports', kind: 'ui', milestone: 'season-2', related_files: ['src/web/reports.ts'] },
  { id: 'calendar', title: 'Calendar', kind: 'ui', related_files: ['src/web/calendar.ts'] },
  { id: 'sign-in', title: 'Sign in and sign up', kind: 'ui', related_files: ['src/web/login.ts', 'src/web/signup.ts'] },
  { id: 'notices', title: 'Notices', kind: 'ui', related_files: ['src/web/notices.ts'] },
  { id: 'go-live', title: 'Go live', kind: 'logic', milestone: 'launch', status: 'blocked', blocked_on: 'you', blocker_reason: 'Pay for the host, then one deploy', related_files: [] },
  { id: 'sign-off', title: "Treasurer's sign-off", kind: 'logic', milestone: 'launch', status: 'blocked', blocked_on: 'you', blocker_reason: 'The treasurer signs off the invoice wording', related_files: [] },
]

export const SERVER_MILESTONES = [
  { id: 'season-2', title: 'Season 2: bookings and invoices' },
  { id: 'launch', title: 'Launch: host and sign-off' },
]

/**
 * What git and the test runner answer for it: every page changed in the last
 * two days, two pull requests merged this week, no deploy branch or tag, and a
 * green suite.
 */
export function serverRepo(nowMs: number) {
  const at = (hours: number) => new Date(nowMs - hours * 3_600_000).toISOString()
  const code = Object.keys(SERVER_APP).filter(path => path.startsWith('src/'))
  const log = [`@@${at(20)}\taaa0001\tPages read the store`, ...code, '', `@@${at(40)}\taaa0000\tStart Plotline`, ...Object.keys(SERVER_APP)].join('\n')
  const merges = [
    `@@${at(6)}\tbbb0002\tMerge pull request #42 from plotline/invoices`,
    'src/web/invoices.ts',
    'src/core/invoices.ts',
    'src/web/reports.ts',
    '',
    `@@${at(30)}\tbbb0001\tMerge pull request #41 from plotline/bookings`,
    'src/web/bookings.ts',
    'src/core/bookings.ts',
  ].join('\n')
  const tests = Object.keys(SERVER_APP).filter(path => /\.test\.ts$/.test(path))
  return (argv: readonly string[]): { exitCode: number; stdout: string } | null => {
    const [tool, command] = argv
    if (tool === 'npm') return { exitCode: 0, stdout: `${tests.map(path => ` ✓ ${path}`).join('\n')}\n\n Test Files  ${tests.length} passed` }
    if (tool !== 'git') return null
    if (command === 'ls-files') return { exitCode: 0, stdout: argv.includes('--cached') ? Object.keys(SERVER_APP).join('\n') : '' }
    if (command === 'log') return { exitCode: 0, stdout: argv.includes('--first-parent') ? merges : argv.some(arg => arg.startsWith('--format=@@')) ? log : '' }
    if (command === 'rev-parse') return argv.includes('HEAD') ? { exitCode: 0, stdout: 'bbb0002\n' } : null
    if (command === 'for-each-ref') return { exitCode: 0, stdout: `refs/heads/main\tbbb0002\t${at(6)}\n` }
    if (command === 'grep') return { exitCode: 1, stdout: '' }
    if (command === 'remote') return { exitCode: 2, stdout: '' }
    return { exitCode: 0, stdout: '' }
  }
}
