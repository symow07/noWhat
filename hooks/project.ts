// Pure helpers about where a project's files are and what git printed. The
// calls that reach disk or git live in register.tsx, since `$` never crosses
// an import.

/** Where a project keeps its noWhat data: the features file, and the derived evidence beside it. */
export const DATA_FILE = '.claude/nowhat.json'
export const EVIDENCE_FILE = '.claude/nowhat/evidence.json'

/** Where a session's project keeps its noWhat data, and how its own paths read. */
export type Place = {
  /** The main checkout: a worktree's data is its repository's. */
  root: string
  /** The checkout this session edits in (a worktree's own folder, or `root`). */
  checkout: string
}

/** The main checkout from `git rev-parse --git-common-dir`, else the checkout itself. */
export function placeFrom(sessionRoot: string, commonDir: string | null, topLevel: string | null): Place {
  const common = commonDir?.trim() ?? ''
  const top = topLevel?.trim() || sessionRoot
  const root = common.endsWith('/.git') ? common.slice(0, -'/.git'.length) : top

  return { root, checkout: top }
}

/** A path the session edited, relative to its checkout; null outside it or in `.claude/`. */
export function projectPath(place: Place, path: string): string | null {
  for (const base of [place.checkout, place.root]) {
    if (!path.startsWith(`${base}/`)) continue
    const relative = path.slice(base.length + 1)
    return relative.startsWith('.claude/') ? null : relative
  }

  return null
}

export type GitSince = { commits: string[]; files: string[]; uncommitted: string[] }

/** Reads `git log --pretty=format:@@... --name-only` and `git status --porcelain`. */
export function parseGit(log: string, status: string): GitSince {
  const commits: string[] = []
  const files = new Set<string>()
  for (const line of log.split('\n')) {
    if (line.startsWith('@@')) commits.push(line.slice(2))
    else if (line.trim() !== '') files.add(line.trim())
  }
  const uncommitted = status
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => line.slice(3).split(' -> ').pop() ?? '')
    .filter(path => path !== '' && !path.startsWith('.claude/'))

  return { commits, files: [...files].filter(path => !path.startsWith('.claude/')), uncommitted }
}

// Read-modify-write of one file must not interleave within this session.
let queue: Promise<unknown> = Promise.resolve()
export function serial<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work)
  queue = run.catch(() => undefined)
  return run
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function titleFrom(text: string | undefined): string | null {
  const line = text?.replace(/\s+/g, ' ').trim() ?? ''
  if (line === '') return null
  return line.length > 60 ? `${line.slice(0, 59)}…` : line
}
