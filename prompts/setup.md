Set up noWhat for this project: group its code into features. The plugin detects every state it can prove; your job is the part code can't decide on its own: which files make up which feature. Don't ask the user to confirm what's done: the evidence decides.

1. Read the inventory below: stack, screens, server routes, test commands, env vars the code reads, hosts, docs, the most-changed files and recent commits.
2. Group the code into features at the level the user would name them ("Login screen", "Charts", "Push reminders"), usually 8 to 30. Read only what you need to group correctly: screen and route file names, the modules they import, and recent commit messages. Planning docs are the weakest evidence: use them only for work that has no code yet.
3. For each feature give:
   - id (kebab-case), title, a one-line description
   - kind: ui if it has a screen, logic if not
   - related_files: the files that implement it, as project-relative paths. This is what detection reads, so be precise: its screen(s), its main logic module(s), its route handler(s). 2 to 8 files.
   - needs_config: the env var names it can't work without, when a shared config module reads them rather than its own files: an API key, OAuth client ids, a webhook secret. The plugin checks each name on the deploy host and blocks the feature on the user if it's missing. Leave out keys with a working default.
   - depends_on: ids of features it can't move on until they're done
   - note, only when you know something the code doesn't show: at most 4 terse lines of facts ("Done: parser. Next: webhook.")
   - milestone, only when the repository states phases (GitHub milestones, release tags, a planning doc's phases); otherwise no milestones at all
   - status only for work with no code yet: not_started, or queued for what's planned next, in order. Leave status out for everything that has code: the plugin derives it
   Don't set ui_state, functional_state or verified_by: the evidence sets them.
4. Save it with one mcp__nowhat__setup call (with milestones if you used any). Its result says what the evidence showed.
5. Call mcp__nowhat__detect with tests: true, so the project's test suites prove which features work.
6. Tell the user what was found in a few terse bullets (a headline and facts, no filler): how many features, what's done and proven, what waits on them, what's next. Ask only about something the code genuinely can't reveal, batched into one question, and only if it matters.
