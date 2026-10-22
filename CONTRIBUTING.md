# Contributing to noWhat

Thanks for helping. Bug reports, fixes and new stacks or hosts are all welcome.

## Run it from a local folder

Point Claude Code at your clone in `~/.claude/settings.json`:

```json
{
  "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/noWhat" }
}
```

Or start one terminal session with `claude --plugin-dir /path/to/noWhat`. The plugin loads when a session starts: after changing its code, run `/reload-plugins` or start a new session. Data never needs a reload.

## Check your change

```
claude plugin validate .
claude plugin test .
npx -p typescript tsc -p .
```

All three must pass. A change to what the sidebar shows needs a test in `tests/pane.test.ts`; a new rule needs one in the test file of the module it lives in.

## Test data: fixtures only

Tests use fixtures: the in-memory project in `tests/world.ts` and the file lists in `tests/detect.test.ts`. For anything that needs real git, use a throwaway repository under `.sandbox/` (ignored by git), or the demo:

```
node docs/demo/make-demo.mjs .sandbox/acme-notes
```

Never test on, or copy data from, a real project: not yours, not anyone's. Fixtures and screenshots use made-up names (Acme Notes, example domains).

## Where things live

- `hooks/register.tsx`: everything that touches disk, git, CLIs and the network (`$` can't cross an import)
- `hooks/*.ts`: pure modules the tests run directly: detection, rules, the file format, insights, the launch checklist, the sidebar
- `prompts/`: the standing rules, and the instructions for setup, sort and continue

[docs/how-it-works.md](docs/how-it-works.md) explains the evidence and the rules, and how to add a host or a stack.

## Style

- Text in the sidebar and in Claude's notes is a status board: a headline and facts, short and blunt.
- Detection fails as *unknown*, never as *missing*: a false alarm costs more trust than a gap.
- Keep it zero-token: only the three buttons that start Claude may spend tokens.

## Pull requests

One change per pull request, with a line on what it fixes or adds and how you checked it. By contributing you agree your work is released under the [MIT license](LICENSE).
