# Changelog

## Unreleased

Calibration: what noWhat can't read no longer counts against a project.

### Fixed

- **Wiring that timed out read as "nothing references this".** One `git grep -w` over a large repository could run for minutes against a 30-second cap, and the empty answer marked every file unwired, so nothing could reach *working*. Wiring now comes from one read of the files' text (about a second for a few thousand files), and a file noWhat couldn't read leaves wiring *unknown*, never *unwired*. Every other `git grep` that fails or times out is now *unknown* too.
- **Server-rendered pages weren't screens.** Only component files counted, so a server whose route handlers return HTML showed UI 0%. The UI style is now decided first, and server pages are recognised by what they contain. With no screen recognisable at all, UI shows *unknown*, not 0%.
- **Integration tests mapped to nothing.** Tests that call URLs now count for the modules behind the routes they call; a module nearly every handler calls is left out. The sidebar says how many test files map to no feature.
- **Finished work stayed "in progress".** Work in progress that's proven and has no uncommitted edits becomes done, unless Claude set it in progress. When the whole suite passes and none of a feature's tests map to it, it's *built, tests not mapped*, not in progress. A coverage report, when the project has one, counts too.
- **A recorded status was overruled.** A status Claude gives at setup or later is kept; *done* stays done, marked *unconfirmed* while nothing proves it, until a failing test or an unreferenced file disproves it.
- **A local `.env` stood in for an unreadable deploy host,** blocking features on keys that live on the host. A host that can't be read is now *unknown*; blocks the `.env` made lift. Names an EAS build profile sets in `eas.json` count as present.
- **Health said *Thriving* with things waiting on you.** Anything waiting on you now makes it *Needs you*.
- **Milestones said "0 of 4 · 25%".** The count and the percentage are now one measure: features built of planned.
- **The weekly summary said "Done: nothing" in a week of merged pull requests.** A built feature a merged pull request changed counts as done, and the summary says how many were merged.
- **Feature names drew as bright native buttons on the desktop.** Only actions are buttons now: a name is plain text, and a *Details* button, shown on hover, opens the row. The terminal is unchanged.

### Changed

- **One new host call, behind host checks only:** `railway status --json`, read-only, for the commit Railway's serving deployment names. It's deployment metadata; no variable value is read or kept. Off until you say yes to host checks for the project, like every other host call.

- The headline is the share of features **built**, and, when a deploy can be seen (the deployed app's own answer, Railway's deployed commit, a deploy branch or tag, or the newest store build), how much is **live**. Otherwise it says *live unknown*. Daily progress entries say which measure they used, so the weekly change never compares the two.
- `scripts/detect-folder.ts` runs detection over any folder read-only and prints what noWhat makes of it, before and after.

## 0.3.0

The first public release. Before it, the plugin was called `roadmap` and was never published.

### Security

- **noWhat now runs only in projects where you ran `/nowhat`.** Until 0.3.0, any project containing the plugin's data file (`.claude/roadmap.json`, later `.claude/nowhat.json`) switched it on: detection, git and host-CLI calls, the sidebar, and Claude's standing rules. That included a cloned repository where someone else had committed the file. Now nothing runs in a project until you run `/nowhat` there, which adds it to `~/.claude/nowhat-projects.json`; a committed data file switches nothing on. `tests/mod.test.ts` checks this.
- **No network calls out of the box.** Host checks (your deploy host's CLI, the launch checklist's requests, your deployed app, GitHub milestones) are now off by default. Setup asks once per project, and the answer is saved in `~/.claude/nowhat-projects.json`, never in the project's files, and switched with *Host checks* in the sidebar. Before 0.3.0 they were on by default. `tests/mod.test.ts` checks that a project with a deploy host gets no CLI calls or requests until you say yes.
- **`check_hosts` covers every network call.** The privacy-policy request, `eas build:list` and `gh api` used to run even with it off.
- **Every hook fails quietly.** An error inside noWhat can no longer block a prompt, a command, a tool call or a session start: the person carries on and the sidebar isn't updated. `tests/mod.test.ts` breaks the disk under noWhat and checks each one.

### Added

- `/nowhat`, one command: sets a project up the first time (Claude groups the code into features), then shows or hides the sidebar.
- The sidebar: header with refresh, an alert strip (regressions, the deployed app down, rabbit holes, stale work), Next up, quick capture, and tabs for Features, Needs you, Decisions and Launch.
- Unsorted files with *Sort with Claude*, for work done in other tools.
- The launch checklist for store and web apps, the decision log, the scope meter, the weekly summary, pinning, and the all-projects view.
- Automatic re-checks: when the sidebar opens, every 5 minutes while it shows, and within 30 seconds of a commit. Zero tokens.
- The Acme Notes demo (`docs/demo`) and the screenshot renderer (`scripts/screenshots`).
