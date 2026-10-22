# How noWhat works

The [README](../README.md) is the short version. This is the long one: what the sidebar shows, how each state is decided, how it stays current, the file format, and how to work on the plugin.

## The sidebar

Nothing shows unless you need it in the first two seconds. Top to bottom:

- **Header:** name, overall %, a refresh button, the progress bar, health (*Thriving*, *Steady*, *Stalled*, *Needs you*) and when it was last checked
- **Alert strip,** only when something is wrong: a feature that *broke* (was working, now its tests fail or a file came unwired), the deployed app *down*, a *rabbit hole* (four or more sessions on one feature with no change in its state), *stale* work, or a project *untouched* for two weeks
- **Next up:** the one thing to work on (something that broke comes first), its catch-up line, and *Continue with Claude*
- **Capture:** one line. Type an idea, press Enter, and it lands in the backlog. No tokens
- **Tabs,** one open at a time:
  - **Features:** grouped by milestone, with ideas in a Backlog group. New files that belong to no feature show first, as *Unsorted*, with a *Sort with Claude* button. Each row is one pill and the name: *Broke*, *Tests failing*, *Needs you*, *Blocked*, *Stale*, *In progress*, *UI ahead*, *Not wired*, *Unverified*, *Queued*, *Not started*, *Parked*, *Idea*. Done rows fold into one line
  - **Needs you:** what only you can clear (an env var, a key, an account, a sign-in), with the exact thing missing and how many features it unblocks
  - **Decisions:** one line per key choice and why, newest first, as Claude records them while it works
  - **Launch:** the common reasons a store or reviewer turns a release back, checked from the repository (below). Shown for store and web apps only
- **Closed sections,** each with a one-line summary, open on click: *Milestones* (a bar each, and UI against functional), *Since last visit* (where you left off, what broke, finished, unblocked, started, got blocked or parked), *Scope this week* (features added against finished, and a warning when adding outpaces finishing) and *Weekly summary* (five lines at most; *Copy* puts it on the clipboard in one click)

Click a feature for its full story: catch-up note, why it broke or was parked, what it waits on and unblocks, its state and proof, sessions spent, recent commits, last session, files, and buttons to pin its status or move it in the queue.

Two accents only: blue for progress, in progress and the one button; red for what broke, the Needs you count and failed launch checks. Everything else is grey. Pills are one fixed width, so names line up, and the "checked" time sits in its own slot, so nothing moves when it updates.

## The launch checklist

The checks depend on the kind of project detection finds. A backend or library has none, and the tab doesn't show.

| Store app (Expo, React Native, Flutter, native) | Web app (Next.js, Remix, SvelteKit, Rails…) |
| :- | :- |
| Privacy policy: the project's own policy URL, found in code or docs, loads | Privacy page |
| Account deletion, when there's sign-up (Apple 5.1.1(v)) | Account deletion, when there's sign-up |
| A build for a real device (the EAS build list) | Terms page |
| Sign in with Apple, when there's another social sign-in (4.8) | HTTPS on the deployed app |
| Restore purchases, when there are in-app purchases (3.1.1) | Cookie consent, when there's analytics |
| Own text in permission prompts (5.1.1) | |
| Privacy manifest, app icon, store screenshots | |

Each check is ✓, ✕ or ? with its evidence in a few words. A check that can't be decided (no git, no EAS) is ?, never ✕. The greps run on every check; the policy URL and the build list are asked on the host-check schedule.

## All projects

*All projects* at the bottom of the sidebar switches to one card per project you set up with noWhat, the most recently active first:

- name, health pill and overall progress, with UI and functional bars under it
- how many blockers wait on you, what's next, and where you left off
- *Active today* and features done, or, after two weeks untouched, *Untouched N days. Pick it up or park it.* on an amber card

Click a card to open the rest: the next feature's note, every blocker with its reason, milestone bars, whether the deployed app answers, and the folder's path with *Copy path*. A mod can't open a session in another folder, so the path is what you take to a new session. A project whose folder or features file has gone is listed as not found rather than dropped.

The list is read from `~/.claude/nowhat-projects.json`. **A project joins it only when you run `/nowhat` in it.** noWhat never registers a project on its own, never looks into folders you didn't run it in, and never decides by name or by guessing that two folders are the same project. Each `.claude/nowhat.json` carries a `project_id`: when you run `/nowhat` in a project you moved, an entry with that exact id whose folder is gone is replaced. The view redraws within 15 seconds when any of those projects changes.

All the text is a status board: a headline and facts. Claude's notes are capped at four short lines and its reasons at one, and the plugin refuses anything longer.

## How it decides a feature's state

Claude does the one thing code can't do by itself: deciding which files make up which feature, and naming it. Everything after that is evidence. The plugin gathers it with a handful of git and CLI calls and no model tokens, then applies fixed rules.

### The evidence

| Evidence | How it's gathered | Works on |
| :- | :- | :- |
| **Inventory**: languages, frameworks, screens, server routes, tests, test commands, hosts | `git ls-files` and the manifests (`package.json`, `pyproject.toml`, `requirements.txt`, `go.mod`, `Cargo.toml`, `Gemfile`, `mix.exs`, `Package.swift`, `pubspec.yaml`, `composer.json`, `pom.xml`, `build.gradle`) | Any repository |
| **Exists**: are the feature's files there? | the file list | Any |
| **Wired**: is each file referenced from anywhere else? Screens a framework routes by location (Next.js, Expo Router, SvelteKit, Nuxt, Astro, Remix) count as wired | one `git grep -o -w -F` over every file's import name | git repositories; unknown without git |
| **Unfinished markers**: `TODO`, `FIXME`, `not implemented`, `unimplemented!`… | one `git grep -c` | Any |
| **Activity**: last change and commits in the last 30 days, uncommitted edits | `git log --name-only`, `git status` | git repositories |
| **Tests**: the test files named for the feature's files (`me.test.ts`, `test_me.py`, `me_test.go`) or importing them by path, and whether they last passed. A word a test merely contains doesn't count | the project's own test command, run at setup, plus every test run Claude does in the session | JS/TS (bun, npm, pnpm, yarn), pytest, Go, Rust, RSpec, Elixir, Swift, Dart/Flutter, Maven, Gradle, PHPUnit |
| **Config**: env vars the feature can't work without, and whether the deploy target has them | reads in its files (`process.env.X`, `os.getenv("X")`, `os.Getenv("X")`, `ENV["X"]`, `env::var("X")`, `System.getenv("X")`…) plus `needs_config` for keys a shared config module reads; checked against the host's CLI, **names only** | Railway, EAS, Vercel, Fly, Netlify; a local `.env` as the last resort |
| **Live**: does the deployed app answer? | an HTTPS request to the public URL (and `/health` when the code has one) | Railway today |

### The rules

They live in `hooks/reconcile.ts` and only move a state on concrete evidence. Unknown never downgrades anything.

1. **UI:** a screen that exists and is reachable makes a UI feature at least *designed*. *Polished* is a judgment (yours or Claude's), so detection never sets it or takes it away.
2. **Functional:** code makes a feature at least *partial*. *Working* needs proof: every file wired, its tests passing, nothing it needs missing. Then it's *working, verified by tests*. Failing tests, or a file nothing references any more, take *working* back. If all its files are gone, it's *none*.
3. **Status:** a feature nobody gave a status starts as *not started* (no code), *done* (healthy), *in progress* (code changed this week) or *done* (older code nobody proved; the sidebar marks it *unverified*). Planned work whose files start moving becomes *in progress*.
4. **Config:** a required env var missing on the deploy target blocks the feature on *you*, naming the var. When it appears, the block lifts and the feature gets back the status it had. A block Claude or you set is never lifted by detection.
5. **Hands off:** a *pinned* feature is never changed by detection, and a *parked* one keeps its status. A file several features share doesn't count as one of them starting, and a feature whose files all belong to other features too gets nothing from their evidence.

*Working* can also be proven by Claude running the feature (`verified_by: ran`) or by you saying so (`user`). *Done* never implies working. A feature that's done but unproven says so instead of counting as finished.

**Who a blocker waits on:** anything waiting on an env var, a key, an account, a purchase, a sign-in or a decision is *Needs you*; real code work is *Needs code*. Claude says which; when it doesn't, the plugin reads it from the reason.

**Dependencies:** a feature can name the features it waits on (`depends_on`). Next up skips it until they're done, its detail says what it's waiting on, and the blocker it waits on says what clearing it unblocks.

Every change detection makes is logged with the source *detected*, so the sidebar can say what it worked out by itself.

### Where it guesses, and how it fails safe

- **Wiring** matches import names, not a full module graph. A very generic file name gets a more specific name (`sync/engine`), and a false *wired* is the safe direction.
- **Test output** is matched to files by path. A red run that names no files changes nothing.
- **Which tests belong to a feature** is decided by name and import path. A route string that looks like an import path (`'/import'`) can still credit a test or two to the wrong feature, and its pass or failure then counts there too.
- **A host CLI** that isn't installed or logged in, or prints a format the parser doesn't know, makes config *unknown*, never *missing*.
- **A key with a real default** (`?? "x"`, `.default("x")`, a comparison flag) isn't required. A bare `.optional()` is still needed by the feature that reads it.
- **A project without tests, a deploy host or git** loses only those signals. *Unverified* needs a test command to mean anything, *Needs config* needs a host, *Not wired* needs git: without one the sidebar doesn't show that signal at all, instead of a row of *unknown*.
- **Detection got one wrong?** Open the feature and pin it. Detection then leaves its status and states alone until you unpin it.

## Staying current

You never edit the features file. Changes reach it four ways, cheapest first:

1. **Evidence, at no token cost:**
   - the sidebar re-checks when it opens, every 5 minutes while it shows, and within 30 seconds of a new commit (yours, Codex's, another session's)
   - the ↻ button re-checks now, host config included
   - a turn in which Claude edited files ends with that evidence re-read, and Claude's own test runs are parsed for results
   - the file is polled every 3 seconds, so any edit to it shows within seconds

   None of these run the test suites (setup and Claude's own test runs do). Host CLIs and the network are asked only when something they depend on changed (HEAD, `.env*`, `eas.json`, `app.json`, a host config file) or 15 minutes have passed.
2. **Claude's notes:** a short set of standing rules (about 450 tokens, fixed text, so the prompt cache keeps it) asks Claude to mark a feature *in progress* before editing for it, *done* when finished, *blocked* with who it's waiting on, *parked* with why, to keep each feature's catch-up note, to record key *decisions*, and to write *where you left off*. Each is one small `mcp__nowhat__update` call. Edits are filed under the feature last put in progress, never guessed, and each session that works on a feature is counted for the rabbit-hole warning.
3. **A status line:** each prompt carries one line on where things stand (about 70 tokens), sent only when it changed.
4. **Unsorted and *Sort with Claude*:** for work done outside Claude Code (Codex, your editor, another machine). New source files no feature claims show as *Unsorted*, found by commit range since the last sort (dates can lie after a rebase) plus untracked files. *Sort with Claude* files them and catches up on the commits.

Data never needs `/reload-plugins`: the features file and the evidence are read fresh on every draw. Only a change to the plugin's own code (or moving its folder) does.

## Files it writes

| File | What | Commit it? |
| :- | :- | :- |
| `.claude/nowhat.json` | The features: statuses, milestones, ideas, decisions, where you left off, five weeks of changes, daily progress, files a sort left out | Your choice. It's readable and diffs cleanly |
| `.claude/nowhat/evidence.json` | Derived evidence: env var names, test results, inventory, launch checks, unsorted files | No: add `.claude/nowhat/` to `.gitignore` |
| `~/.claude/nowhat-projects.json` | Every project you ran `/nowhat` in, for the all-projects view | Lives outside your repositories |

noWhat writes nothing else, and nothing outside the project you run it in.

### `nowhat.json` (schema version 2)

```jsonc
{
  "schema_version": 2,
  "project_id": "5f0c…",                 // stable across moves: how the all-projects list knows it
  "name": "My app",
  "last_touched": "2026-10-13T09:00:00Z",
  "where_i_left_off": "Done: login. Next: reset email.",
  "left_off_at": "2026-10-13T09:00:00Z",
  "synced_at": "2026-10-13T08:00:00Z",
  "synced_commit": "41f030d…",            // the last sort: Unsorted and Sort with Claude read from here
  "milestones": [{ "id": "v1", "title": "Launch v1" }],
  "features": [
    {
      "id": "login",                      // kebab-case, unique
      "title": "Login screen",
      "description": "Email and password sign-in",
      "kind": "ui",                       // ui | logic (logic has no ui_state)
      "milestone": "v1",                  // or null
      "status": "in_progress",            // queued | not_started | in_progress | blocked | parked | done
      "ui_state": "designed",             // none | designed | polished
      "functional_state": "partial",      // none | partial | working
      "verified_by": null,                // ran | tests | user, only when working
      "blocker_reason": null,             // required when blocked
      "blocked_on": null,                 // you | code, when blocked
      "parked_reason": null,              // required when parked
      "note": "Done: form, session.\nNext: reset email.\nDecided: magic link later.", // ≤4 terse lines
      "depends_on": ["email-provider"],   // features it waits on
      "pinned": false,                    // true: detection leaves it alone
      "related_files": ["src/app/login.tsx", "src/lib/auth.ts"],
      "needs_config": ["AUTH_SECRET"],    // env vars a shared config module reads for it
      "last_conversation": { "session_id": "…", "title": "Wire up login", "at": "…" },
      "thumbnail": null,
      "updated_at": "2026-10-13T09:00:00Z",
      "progress_at": "2026-10-13T09:00:00Z", // its state last changed: sessions after this made no progress
      "sessions": [{ "id": "…", "at": "…" }], // sessions that worked on it, last 12
      "regressed": null,                  // { at, reason } while it's broke; set and cleared by detection
      "idea": true                        // only on captured ideas: backlog, left out of progress
    }
  ],
  "recent_changes": [                     // newest first: 35 days (at least 20, at most 400); source: claude | you | outside | detected
    { "at": "…", "id": "login", "title": "Login screen", "field": "status", "from": "queued", "to": "in_progress", "source": "claude" }
  ],
  "decisions": [                          // newest first, last 100: "X, because Y"
    { "at": "…", "text": "Magic link later, because email is not set up yet", "feature": "login" }
  ],
  "progress_log": [{ "day": "2026-10-13", "overall": 41 }], // one a day, 35 days: the weekly summary's change
  "ignored_files": ["scripts/"]           // left out of every feature by a sort: never listed as unsorted
}
```

Progress weights (`none` 0, `designed`/`partial` 0.5, `polished`/`working` 1) and the staleness window (7 days) are constants at the top of `hooks/schema.ts`. Version 1 files are read and upgraded in place.

## Develop

```
hooks/
  register.tsx   the mod: everything that touches disk, git, CLIs and the network
  detect.ts      pure: inventory, wiring, env reads, host output, test output
  reconcile.ts   pure: evidence → states, the rules above
  schema.ts      pure: nowhat.json, validation, progress, edits
  insights.ts    pure: waiting on, unblocks, since your last visit, health, alerts, scope, weekly summary
  launch.ts      pure: the launch checklist for store and web apps
  portfolio.ts   pure: one card per project for the all-projects view
  view.tsx       pure: the dashboard
  project.ts     pure: paths and git output helpers
prompts/         rules.md, the standing rules Claude reads; setup.md, sort.md, next.md, each button's instructions
tests/           fixtures only (an in-memory project, Expo + Bun, Flask and Go file lists); never a real project
docs/demo/       the Acme Notes demo project and its generator
scripts/screenshots/  regenerates docs/media from the demo
```

Test on fixtures, or on a throwaway repository under `.sandbox/` (ignored by git), never on a real project. See [CONTRIBUTING.md](../CONTRIBUTING.md).

`$` (the engine interface) can't cross an import, so every side effect lives in `register.tsx` and every decision lives in a pure module the tests run directly.

```
claude plugin validate .
claude plugin test .
npx -p typescript tsc -p .
```

**Adding a host:** add its config file to `hostsOf` and its output to `envNamesFrom` in `detect.ts`, add a branch to `checkHosts` in `register.tsx`, and add a fixture to `tests/detect.test.ts`. An adapter has to fail as *unknown*, never as *missing*.

**Adding a stack:** frameworks, screen conventions, test files and test commands each have one table or function in `detect.ts`, with fixtures in `tests/detect.test.ts`.

## Limitations

- Wiring is detected for git repositories only.
- Thumbnails and clickable files are on the way.
- The launch checklist reads the repository, so it can't see what lives only in App Store Connect or Play Console (the privacy policy URL entered there, review notes, a demo account).
- Mobile (the Claude app) has no text field yet, so the capture line shows on desktop and in the terminal only.
- A project card can't open its project: no mod API starts a session in another folder. *Copy path* is the way across.
- No global keyboard shortcut: `/nowhat` toggles the sidebar.
- A mod's command can't start a turn while it runs, so `/nowhat` sends the setup prompt as soon as its own turn ends. Where a host doesn't allow that either, the prompt lands in the composer for one Enter, and *Set up with Claude* is in the sidebar.
