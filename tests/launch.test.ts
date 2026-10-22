import { describe, expect, test } from 'claude-code/testing'

import { type LaunchFacts, deviceBuildOf, launchChecks, launchKind, privacyUrlOf } from '../hooks/launch'

const app = (fields: Partial<LaunchFacts> = {}): LaunchFacts => ({
  kind: 'app',
  found: {},
  files: ['mobile/app.json', 'mobile/eas.json'],
  appConfig: '{ "expo": { "icon": "./icon.png" } }',
  privacy: { url: 'https://acme.example/privacy', status: 200 },
  deviceBuild: 'device',
  liveUrl: null,
  ...fields,
})

const states = (facts: LaunchFacts) => Object.fromEntries(launchChecks(facts).map(check => [check.id, check.state]))

describe('what kind of launch', () => {
  test('a store app wins over a web app; a backend alone has no checklist', () => {
    expect(launchKind(['Expo', 'Hono'], [])).toBe('app')
    expect(launchKind(['Next.js'], [])).toBe('web')
    expect(launchKind([], ['App.xcodeproj/project.pbxproj'])).toBe('app')
    expect(launchKind(['Hono', 'Prisma'], [])).toBeNull()
  })
})

describe('evidence readers', () => {
  test("the project's own privacy URL, not a vendor's", () => {
    const urls = [
      'https://acme.example/privacy',
      'https://acme.example/privacy',
      'https://sentry.io/privacy/',
      'https://acme-production.up.railway.app/privacy',
      'https://example-news.com/privacy',
      'https://acme.example/privacy).',
    ]
    expect(privacyUrlOf(urls)).toBe('https://acme.example/privacy')
    expect(privacyUrlOf(['https://www.apple.com/legal/privacy/'])).toBeNull()
    // With no domain of its own yet, the platform address it's served from.
    expect(privacyUrlOf(['https://sentry.io/privacy/', 'https://acme-production.up.railway.app/privacy'])).toBe('https://acme-production.up.railway.app/privacy')
  })

  test('EAS builds: a device build, simulator only, none, or unreadable', () => {
    expect(deviceBuildOf('[{"status":"FINISHED","distribution":"INTERNAL"}]')).toBe('device')
    expect(deviceBuildOf('[{"status":"FINISHED","distribution":"SIMULATOR"},{"status":"ERRORED","distribution":"STORE"}]')).toBe('simulator')
    expect(deviceBuildOf('[]')).toBe('none')
    expect(deviceBuildOf('Not logged in')).toBeNull()
  })
})

describe('the checklist', () => {
  test('a ready app passes; what does not apply is not listed', () => {
    expect(states(app({ found: { accounts: ['api/auth.ts'], deletion: ['routes/me.ts'] } }))).toEqual({
      privacy: 'ok',
      deletion: 'ok',
      'device-build': 'ok',
      'privacy-manifest': 'unknown',
      icon: 'ok',
      screenshots: 'fail',
    })
  })

  test("Apple's usual rejections, failures first", () => {
    const checks = launchChecks(
      app({
        found: { accounts: ['auth.ts'], social: ['login.tsx'], purchases: ['pay.ts'], permissions: ['camera.tsx'] },
        privacy: { url: 'https://acme.example/privacy', status: 404 },
        deviceBuild: 'simulator',
        appConfig: '{ "expo": { "icon": "./icon.png", "plugins": ["expo-camera"] } }',
      }),
    )
    expect(checks.filter(check => check.state === 'fail').map(check => check.id)).toEqual([
      'privacy',
      'deletion',
      'device-build',
      'apple-sign-in',
      'restore',
      'permission-text',
      'screenshots',
    ])
    expect(checks[0]?.evidence).toBe('Answers 404 · acme.example/privacy')
    expect(checks.find(check => check.id === 'device-build')?.evidence).toBe('Simulator builds only')
    // Failures, then unknowns, then passes.
    expect(checks.map(check => check.state)).toEqual([...checks.map(check => check.state)].sort((a, b) => ['fail', 'unknown', 'ok'].indexOf(a) - ['fail', 'unknown', 'ok'].indexOf(b)))
  })

  test('own permission text passes; without git, code checks are unknown, never failed', () => {
    const custom = app({ found: { permissions: ['camera.tsx'] }, appConfig: '{ "plugins": [["expo-camera", { "cameraPermission": "Scan receipts" }]], "icon": "x" }' })
    expect(states(custom)['permission-text']).toBe('ok')
    expect(states(app({ found: null })).deletion).toBe('unknown')
  })

  test('a web app: privacy and terms pages, HTTPS, consent when it tracks', () => {
    const web: LaunchFacts = {
      kind: 'web',
      found: { analytics: ['app/layout.tsx'] },
      files: ['app/privacy/page.tsx'],
      appConfig: null,
      privacy: { url: null, status: null },
      deviceBuild: null,
      liveUrl: 'https://shop.example.org',
    }
    expect(states(web)).toEqual({ privacy: 'ok', terms: 'fail', https: 'ok', consent: 'fail' })
  })
})
