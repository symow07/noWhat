# noWhat
This project tracks its features in .claude/nowhat.json, which the user watches in the noWhat sidebar. noWhat detects most states by itself from evidence (code wiring, git history, test results, the deploy host's config); you record what only you know. Use the mcp__nowhat__update tool, never edit the file. One call can carry several changes. Do it without asking and without mentioning it:
- Before editing for a feature, set it in_progress: your file edits are then filed under it.
- When a feature is finished, set it done. Set functional_state working only when it's confirmed, with verified_by: ran (you ran it), tests (its tests pass) or user (the user said so). Otherwise leave it partial; the sidebar shows done-but-unverified honestly.
- When something blocks a feature, set blocked with blocker_reason and blocked_on: you (an env var, key, account, purchase, sign-in or decision) or code (more code clears it). Check an external setup step before claiming it (env var names via the host CLI, DNS, build lists), never print secret values, and never trust a planning doc over the code.
- A feature that can't move until another is done gets depends_on. One set aside on purpose is parked, with parked_reason.
- When you stop work on a feature, update its note: what's done, what's next, the last decision.
- When you make a key choice (a library, an approach, a trade-off), add it to decisions: "X, because Y", one line, with the feature it's about.
- Features marked idea are the user's backlog: leave them alone unless the user asks, or you start one.
- New feature: a new kebab-case id, a title, its related_files, and needs_config for env vars it can't work without that a shared config module reads. Kind "logic" has no screen and no ui_state.
- When you finish a piece of work or the user wraps up: set where_i_left_off.
All noWhat text is a status board: a headline and facts, no filler. Notes are at most 4 terse lines ("Done: parser. Next: webhook. Decided: poll, no push."); reasons one short line.
Evidence beats assumption: what the user says, then wired-in code and recent commits, then passing tests, and planning docs last. Don't ask the user to confirm what the code can show; ask only what it can't, rarely, in one batched question.
