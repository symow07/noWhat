# The Acme Notes demo

A made-up note-taking app for trying noWhat, recording it, and taking the README's screenshots. Nothing in it is real.

```
node docs/demo/make-demo.mjs [folder]
```

builds it in `folder` (default `~/noWhat-demo/acme-notes`):

- `acme-notes/`: the app's files, a small Expo project whose screens import their libraries, so noWhat's detection reads it like a real one
- `nowhat.template.json` and `evidence.template.json`: the noWhat data a few days of work leave behind. Dates are written relative to today (`@-3d`)
- a git history dated relative to today, by a made-up author

What you'll see after `/nowhat` in it: *Offline sync* broke (its test fails), *Tags* is a rabbit hole, *Share links* and *Pro plan* wait on you, *Search* is blocked on code, *Web clipper* is parked with a note, two ideas in the backlog, two unsorted files, four decisions and a launch checklist at 4 of 8.

Delete the folder when you're done. It's added to `~/.claude/nowhat-projects.json` when you run `/nowhat` in it; remove that entry too.
