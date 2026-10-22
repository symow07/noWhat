// The launch checklist: the common reasons a store or a reviewer turns a
// release back, checked from the repository. Pure: register.tsx runs the greps,
// reads the app config and asks the network; this file decides.
//
// Each check is ok, fail or unknown, with the evidence in a few words. A check
// that doesn't apply (no sign-in, no purchases) isn't listed at all.

/** What kind of release the project has: a store app, a web app, or neither (a library, a CLI). */
export type LaunchKind = 'app' | 'web'

export type LaunchState = 'ok' | 'fail' | 'unknown'

export type LaunchCheck = { id: string; label: string; state: LaunchState; evidence: string }

/** One `git grep -l -i -E` per pattern; the files that match say what the code does. */
export const LAUNCH_PATTERNS = {
  accounts: 'sign[_-]?up|createUser|create_user|registerUser|better-auth|next-auth|@clerk/|firebase/auth|supabase\\.auth|auth0|devise',
  deletion: 'delete[_-]?account|deleteAccount|account[_-]deletion|deleteUser|delete_user|destroyUser|\\.delete\\([\'"`]/(me|account|user)[\'"`]',
  social: '@react-native-google-signin|expo-auth-session/providers/(google|facebook)|GoogleSignIn|signInWithGoogle|GoogleAuthProvider|FacebookAuthProvider|react-native-fbsdk|signIn\\.social|socialProviders',
  apple: 'expo-apple-authentication|AppleAuthentication|ASAuthorizationAppleIDProvider|appleAuth|SignInWithApple|provider:\\s*[\'"]apple[\'"]',
  purchases: 'react-native-purchases|expo-in-app-purchases|react-native-iap|StoreKit|Purchases\\.configure|BillingClient',
  restore: 'restorePurchases|restoreTransactions|AppStore\\.sync|restoreCompletedTransactions|getAvailablePurchases',
  permissions: 'expo-camera|expo-image-picker|expo-location|expo-contacts|expo-media-library|expo-calendar|expo-audio|expo-av|@react-native-voice|AVCaptureDevice|CLLocationManager|PHPhotoLibrary',
  analytics: 'googletagmanager|gtag\\(|posthog|mixpanel|@segment/|amplitude|hotjar|fbq\\(',
  consent: 'cookie[_-]?consent|cookieconsent|CookieBanner|cookie-banner|consentManager|onetrust|cookiebot',
} as const

export type LaunchPattern = keyof typeof LAUNCH_PATTERNS

/** Frameworks that ship to a store, and ones that ship to the web. */
const APP_FRAMEWORKS = /^(Expo|React Native|Flutter|Android)$/
const WEB_FRAMEWORKS = /^(Next\.js|Remix|SvelteKit|Nuxt|Astro|Angular|Vue|React|Svelte|Solid|Rails|Django|Laravel|Phoenix)$/

/** The project's release kind: a store app wins over a web app (a monorepo with both is a store app). */
export function launchKind(frameworks: readonly string[], files: readonly string[]): LaunchKind | null {
  if (frameworks.some(name => APP_FRAMEWORKS.test(name))) return 'app'
  if (files.some(file => /(^|\/)(Info\.plist|AndroidManifest\.xml|pubspec\.yaml)$/.test(file) || /\.xcodeproj\//.test(file))) return 'app'
  if (frameworks.some(name => WEB_FRAMEWORKS.test(name))) return 'web'
  return null
}

/** Hosts whose privacy pages are someone else's: a link to them is not the project's policy. */
const THIRD_PARTY = /(^|\.)(apple|google|googleapis|facebook|meta|expo|revenuecat|stripe|plaid|openai|anthropic|sentry|github|gitlab|vercel|railway|netlify|w3|mozilla|microsoft|spotify|notion|cloudflare|amazon|aws|firebase|supabase|clerk|auth0|example|example-[a-z]+|localhost)\.[a-z.]+$/i

/** A deploy platform's own subdomain: the project's address until it has a domain of its own. */
const PLATFORM_HOST = /\.(up\.)?railway\.app$|\.vercel\.app$|\.netlify\.app$|\.fly\.dev$|\.onrender\.com$|\.pages\.dev$/

/**
 * The project's own privacy-policy URL among every privacy URL in the repo
 * (code and docs): the most-cited host that isn't a third party's, preferring
 * a domain of its own over a platform subdomain; among its URLs, the most cited.
 */
export function privacyUrlOf(urls: readonly string[]): string | null {
  const parsed = urls
    .map(url => url.replace(/[).,;'"`>\]]+$/, ''))
    .flatMap(url => {
      try {
        const host = new URL(url).hostname
        // A platform subdomain is the project's own address; the platform's own site is a vendor's.
        if (PLATFORM_HOST.test(host)) return [{ url, host }]
        return THIRD_PARTY.test(host) || /^(127\.|10\.|192\.168\.)/.test(host) ? [] : [{ url, host }]
      } catch {
        return []
      }
    })
  const own = parsed.filter(one => !PLATFORM_HOST.test(one.host))
  const pool = own.length > 0 ? own : parsed
  if (pool.length === 0) return null
  const top = (items: readonly string[]) => {
    const counts = new Map<string, number>()
    for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
  }
  const host = top(pool.map(one => one.host))
  return top(pool.filter(one => one.host === host).map(one => one.url)) ?? null
}

/** What the EAS build list says about builds that run on a real device. */
export function deviceBuildOf(json: string): 'device' | 'simulator' | 'none' | null {
  let builds: unknown
  try {
    builds = JSON.parse(json)
  } catch {
    return null
  }
  if (!Array.isArray(builds)) return null
  const finished = builds.filter(build => typeof build === 'object' && build !== null && /finished/i.test(String((build as Record<string, unknown>).status ?? '')))
  if (finished.length === 0) return 'none'
  const onDevice = finished.some(build => !/simulator/i.test(String((build as Record<string, unknown>).distribution ?? '')))
  return onDevice ? 'device' : 'simulator'
}

export type LaunchFacts = {
  kind: LaunchKind
  /** Pattern → the files matching it; null without git (then those checks are unknown). */
  found: Partial<Record<LaunchPattern, readonly string[]>> | null
  files: readonly string[]
  /** app.json (or app.config.*) as text, for a store app. */
  appConfig: string | null
  privacy: { url: string | null; status: number | null }
  /** From the EAS build list; null where the project doesn't use EAS or it couldn't be asked. */
  deviceBuild: 'device' | 'simulator' | 'none' | null
  /** The deployed app's address, for a web app's HTTPS check. */
  liveUrl: string | null
}

const name = (path: string) => path.split('/').pop() ?? path
const shortUrl = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '')

/** The checklist for the project's kind; failures first, then unknowns, then what passed. */
export function launchChecks(facts: LaunchFacts): LaunchCheck[] {
  const checks: LaunchCheck[] = []
  const has = (pattern: LaunchPattern) => (facts.found === null ? null : (facts.found[pattern]?.length ?? 0) > 0)
  const first = (pattern: LaunchPattern) => facts.found?.[pattern]?.[0]
  const add = (id: string, label: string, state: LaunchState, evidence: string) => checks.push({ id, label, state, evidence })
  const config = facts.appConfig ?? ''

  // Privacy policy: every store, and any web app that collects anything.
  const route = facts.files.find(file => /(^|\/)privacy([-_]policy)?(\/(page|index))?\.(tsx|jsx|ts|js|md|mdx|html|astro|svelte|vue)$/i.test(file))
  if (facts.privacy.url !== null) {
    const status = facts.privacy.status
    add(
      'privacy',
      'Privacy policy',
      status === null ? 'unknown' : status >= 200 && status < 400 ? 'ok' : 'fail',
      status === null
        ? `Not checked yet · ${shortUrl(facts.privacy.url)}`
        : status >= 200 && status < 400
          ? `Loads · ${shortUrl(facts.privacy.url)}`
          : `${status ? `Answers ${status}` : "Doesn't load"} · ${shortUrl(facts.privacy.url)}`,
    )
  } else if (route && facts.kind === 'web') add('privacy', 'Privacy policy', 'ok', `${name(route)} page`)
  else add('privacy', 'Privacy policy', 'fail', facts.kind === 'app' ? 'No URL found' : 'No page found')

  // Account deletion: Apple 5.1.1(v) for any app with sign-up; GDPR for the web.
  const accounts = has('accounts')
  if (accounts !== false) {
    const deletion = has('deletion')
    add(
      'deletion',
      'Account deletion',
      deletion === null ? 'unknown' : deletion ? 'ok' : 'fail',
      deletion === null ? 'Needs git to check' : deletion ? `In ${name(first('deletion') ?? '')}` : 'Sign-up, no delete',
    )
  }

  if (facts.kind === 'app') {
    add(
      'device-build',
      'Device build',
      facts.deviceBuild === 'device' ? 'ok' : facts.deviceBuild === null ? 'unknown' : 'fail',
      facts.deviceBuild === 'device' ? 'Built for a real device' : facts.deviceBuild === 'simulator' ? 'Simulator builds only' : facts.deviceBuild === 'none' ? 'No builds yet' : 'No build list to read',
    )

    // Apple 4.8: another sign-in service means Sign in with Apple too.
    if (has('social')) {
      add('apple-sign-in', 'Sign in with Apple', has('apple') ? 'ok' : 'fail', has('apple') ? `In ${name(first('apple') ?? '')}` : 'Other social sign-in, no Apple')
    }

    // Apple 3.1.1: in-app purchases need a restore button.
    if (has('purchases')) {
      add('restore', 'Restore purchases', has('restore') ? 'ok' : 'fail', has('restore') ? `In ${name(first('restore') ?? '')}` : 'Purchases found, no restore')
    }

    // Apple 5.1.1: the text asking for camera, photos, mic or location must say why.
    if (has('permissions')) {
      const custom = /NS[A-Za-z]+UsageDescription|(camera|photos|microphone|location[A-Za-z]*|contacts|calendars?|savePhotos|faceID)Permission/.test(config)
      add('permission-text', 'Permission text', custom ? 'ok' : facts.appConfig === null ? 'unknown' : 'fail', custom ? 'Own text in app config' : facts.appConfig === null ? 'No app config to read' : 'Library defaults only')
    }

    const manifest = facts.files.some(file => /PrivacyInfo\.xcprivacy$/.test(file)) || /privacyManifests/.test(config)
    add('privacy-manifest', 'Privacy manifest', manifest ? 'ok' : 'unknown', manifest ? 'Declared' : 'Not declared')

    const icon = /"icon"\s*:/.test(config) || facts.files.some(file => /AppIcon\.appiconset\/|mipmap-[a-z]+\/ic_launcher/.test(file))
    add('icon', 'App icon', icon ? 'ok' : 'fail', icon ? 'Set' : 'None set')

    const shots = facts.files.filter(file => /(^|\/)(fastlane\/screenshots|screenshots|store\/screenshots|metadata\/[^/]+\/screenshots|app-store\/screenshots)\/.+\.(png|jpe?g)$/i.test(file))
    add('screenshots', 'Store screenshots', shots.length > 0 ? 'ok' : 'fail', shots.length > 0 ? `${shots.length} in the repo` : 'None found')
  } else {
    const terms = facts.files.find(file => /(^|\/)(terms|tos|terms[-_]of[-_](service|use))(\/(page|index))?\.(tsx|jsx|ts|js|md|mdx|html|astro|svelte|vue)$/i.test(file))
    add('terms', 'Terms of service', terms ? 'ok' : 'fail', terms ? `${name(terms)} page` : 'No terms page found')
    if (facts.liveUrl !== null) {
      const https = facts.liveUrl.startsWith('https://')
      add('https', 'HTTPS', https ? 'ok' : 'fail', https ? 'Deployed over HTTPS' : 'Deployed over plain HTTP')
    }
    if (has('analytics')) {
      add('consent', 'Cookie consent', has('consent') ? 'ok' : 'fail', has('consent') ? `In ${name(first('consent') ?? '')}` : 'Analytics found, no consent banner')
    }
  }

  const order: Record<LaunchState, number> = { fail: 0, unknown: 1, ok: 2 }
  return checks.map((check, index) => ({ check, index })).sort((a, b) => order[a.check.state] - order[b.check.state] || a.index - b.index).map(({ check }) => check)
}

/** "App Store · Play" or "Web": what the checklist is for. */
export const launchTitle = (kind: LaunchKind) => (kind === 'app' ? 'App Store · Play' : 'Web launch')
