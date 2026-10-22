# Screenshots

Regenerates the README's screenshots in `docs/media` from the [Acme Notes demo](../../docs/demo). Run it after a change to what the sidebar shows.

```
node scripts/screenshots/render.mjs            # the screenshots
node scripts/screenshots/render.mjs --brand    # also the wordmark and the plugin icon
```

It builds the demo, runs noWhat's detection over it (`evidence.ts`), mounts the real sidebar in Claude Code's plugin test kit in each state (`render-test.template.ts`), and renders each drawing in dark and light at 2x with a headless Chromium browser. The two other projects in the all-projects view come from `companions.json`.

Needs:

- Node 20+ and [Bun](https://bun.sh) (the detection step imports the plugin's TypeScript modules)
- Claude Code with `claude plugin test`, as `claude` on your PATH or `CLAUDE_BIN=/path/to/claude`
- Chrome, Brave or Chromium, found by itself or set with `BROWSER=/path/to/browser`

Scratch files go to `.sandbox/screenshots` (ignored by git). The pictures are an HTML rendering of the sidebar's real drawing, so spacing differs a little from the app's own. `hero.gif` isn't generated: it's a recording of the app.
