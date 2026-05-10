# Pi Feature Roadmap

## Status

Complete

## Intent

Respond to the user's requested Pi feature set: RST-to-PDF output, ask mode, plan mode, and skills.

## Scope

- Map each requested feature to Pi's existing primitives.
- Identify which items are built in versus extension/package work.
- Keep this response at design/implementation-roadmap level unless the user asks to implement.

## Files to Touch

- `packages/docs/plans/2026-05-10_pi-feature-roadmap.md`
- `packages/docs/index.md`

## Read-only Bash Design Notes

For ask/plan modes, bash can be available only through a fail-closed read-only policy:

- Keep `bash` active, but intercept `tool_call` for `bash` while ask/plan mode is active.
- Parse shell input, block on parse failure, and allow only a restricted single-command/pipeline subset.
- Prefer command allowlists plus subcommand/flag validation over mutation blacklists.
- Block redirection to files, here-docs, command substitution, process substitution, shell functions, aliases, `eval`, `source`, `sh -c`, language `-e/-c` execution, `xargs`, and command runners that can execute arbitrary nested commands.
- Allow safe inspection tools such as `pwd`, `ls`/`eza`, `cat`/`bat`, `head`, `tail`, `wc`, `file`, `stat`, `rg`, constrained `fd`/`find`, and constrained read-only `git` subcommands.
- Treat post-run dirty checks as a backstop, not the primary guarantee.
- Plan mode may need a narrow exception for writing plan artifacts, and RST rendering may need a narrow exception for writing `.pi/artifacts/*.rst` and `.pdf` outputs.

## Verification

- Used the previously inspected Pi documentation plus loaded TypeScript/Bun skills.
- Mapped each requested feature to Pi primitives: extensions, tools, commands, prompt hooks, settings, and built-in skills discovery.
- Updated `packages/docs/index.md` with this plan entry.
- Added read-only bash design notes for ask/plan mode.

## Session Log — 2026-05-10

### Done

- Created `packages/docs/plans/2026-05-10_pi-feature-roadmap.md`.
- Added it to `packages/docs/index.md`.
- Prepared a feature mapping for RST-to-PDF output, ask mode, plan mode, and skills.
- Added read-only bash policy notes for ask/plan mode.

### Remaining

- Implementation is not started; next step is for the user to confirm desired semantics and whether to build a local extension/package.
- Need to choose the exact read-only bash allowlist and artifact-write exceptions.

### Caveats

- Assumed “ask mode” means read-only Q&A/no repo mutation, “plan mode” means plan-first/no repo mutation until approval, and “rst” means reStructuredText.
- Fully proving arbitrary Bash read-only behavior is not realistic; the safe design is a fail-closed restricted subset plus optional sandbox/backstop checks.
