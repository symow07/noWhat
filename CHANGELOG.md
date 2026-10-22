# Changelog

## 0.3.0

The first public release. Before it, the plugin was called `roadmap` and was never published.

### Security

- **noWhat now runs only in projects where you ran `/nowhat`.** Until 0.3.0, any project containing the plugin's data file (`.claude/roadmap.json`, later `.claude/nowhat.json`) switched it on: detection, git and host-CLI calls, the sidebar, and Claude's standing rules. That included a cloned repository where someone else had committed the file. Now nothing runs in a project until you run `/nowhat` there, which adds it to `~/.claude/nowhat-projects.json`; a committed data file switches nothing on. `tests/mod.test.ts` checks this.
- **`check_hosts` now covers every network call.** The privacy-policy request, `eas build:list` and `gh api` (repository milestones, at setup) used to run with it off.
- **Every hook fails quietly.** An error inside noWhat can no longer block a prompt, a command, a tool call or a session start: the person carries on and the sidebar isn't updated. `tests/mod.test.ts` breaks the disk under noWhat and checks each one.

### Added

- `/nowhat`, one command: sets a project up the first time (Claude groups the code into features), then shows or hides the sidebar.
- The sidebar: header with refresh, an alert strip (regressions, the deployed app down, rabbit holes, stale work), Next up, quick capture, and tabs for Features, Needs you, Decisions and Launch.
- Unsorted files with *Sort with Claude*, for work done in other tools.
- The launch checklist for store and web apps, the decision log, the scope meter, the weekly summary, pinning, and the all-projects view.
- Automatic re-checks: when the sidebar opens, every 5 minutes while it shows, and within 30 seconds of a commit. Zero tokens.
- The Acme Notes demo (`docs/demo`) and the screenshot renderer (`scripts/screenshots`).
