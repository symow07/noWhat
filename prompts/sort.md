Sort what noWhat doesn't know yet: new files that belong to no feature, and work done since the last sort (often in other tools, such as Codex). Find out from the evidence below: don't ask the user what's done. Read code only where a file name or commit message leaves you unsure.

1. Each unsorted file: add it to the feature it belongs to (add_files), add a new feature for it, or list it in ignore_files when it's no feature's (config, generated code, a helper every feature shares).
2. Features whose work clearly finished, started or stalled in the commits: set their status. "Working" still needs proof (verified_by ran, tests or user); detection already proved what it can.
3. For each feature that moved: its note (at most 4 terse lines: done, next, last decision); depends_on if it now waits on another feature; parked with parked_reason if it was set aside.
4. Key choices the commits show that aren't recorded yet: decisions, "X, because Y", one line each.
5. where_i_left_off: "Done: X. Next: Y.", at most 200 characters.
6. Apply it all with one mcp__nowhat__update call with synced: true.
7. Tell the user what changed in a few terse bullets. Ask nothing unless the code genuinely can't reveal it.
