# Global Claude Instructions

## Tool & Skill Usage — MANDATORY

Before doing ANY work, scan the available skills list for relevant skills and LOAD THEM. This is not optional.

- **ALWAYS load matching skills first** - If the task involves a technology that has a skill (Dagger, Docker, Terraform, Kubernetes, Git, TypeScript, etc.), load that skill BEFORE taking any action. Do not attempt to solve the problem without the skill.
- **Use MCP tools first** - When MCP servers provide relevant functionality, prefer them over manual approaches
- **Leverage plugins** - Check available plugins before implementing something from scratch
- **Use lightpanda for web browsing** - When fetching web pages, searching the web, or extracting content from URLs, prefer `lightpanda fetch --dump --strip_mode full --log_level fatal <url>` over PinchTab or other browser MCP tools. It's 10x faster with no server setup needed. **All flags use underscores, not hyphens (e.g. `--strip_mode`, `--log_level`, NOT `--strip-mode`, `--log-level`).** Fall back to PinchTab MCP only for interactive page manipulation (clicking, form filling, screenshots) or complex SPAs that lightpanda can't handle.
- **Look deeper** - If CI is failing, a build tool is erroring, or infrastructure has issues, don't just report the surface error. Load the relevant skill and investigate the root cause. The user wants solutions, not descriptions of problems.

Examples of what NOT to do:

- Seeing Dagger CI failures and NOT loading the dagger-helper skill
- Seeing Kubernetes errors and NOT loading kubectl-helper
- Seeing TypeScript errors and NOT loading typescript-helper
- Reporting "your API key is expired" without investigating how to fix it

## Task Completion — Own the Outcome

When asked to get CI passing, fix a build, fix lints, or complete any task with a clear success criterion:

- **Finish the job.** Do not stop until the task objectively succeeds (green CI, clean build, zero lint errors, etc.).
- **Never dismiss failures as "pre-existing."** If CI is red, the build is broken, or lints fail, fix them — regardless of whether you introduced the issue or it existed before. The user asked you to make it pass, not to explain why it doesn't.
- **Banned phrases / patterns:** Do not say things like "pre-existing issue", "unrelated to my changes", "not introduced by this PR", or "out of scope" as justification for leaving something broken. If you were told to make it work, make it work.
- **If truly blocked**, explain exactly what is blocking you and what you tried, then ask for guidance — do not just declare the task done.

## Code Quality Defaults

- Prefer real fixes over bypasses. Do not use `as any`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, or `eslint-disable` unless the user explicitly asks for it or there is no reasonable alternative.
- Do not leave empty `catch` blocks, `test.skip`, or weak assertions like `toBeTruthy()` / `toBeFalsy()` when a stronger assertion is available.
- When finishing a coding task, run the relevant verification commands for the area you changed and fix the failures before you stop.
- Prefer simple, reviewable configuration over hidden automation. If a safeguard matters, document it here or in a skill instead of relying on opaque hook behavior.

## Research Preferences

- When researching topics, emphasize **GitHub**, **Hacker News**, and **Wikipedia** as primary sources.
- Prefer a mix of authoritative first-party sources (official docs, Wikipedia, project READMEs) with real-world anecdotes and discussion from Hacker News.

## Plan Mode — Typst PDF Export

In plan mode, **before calling ExitPlanMode**, render the plan as a PDF:
1. Load the `typst-authoring` skill for Typst language reference
2. Read the plan `.md` file
3. Convert to a well-formatted Typst document designed for quick reviewer comprehension. Use tables for structured comparisons, diagrams (fletcher, CeTZ) for architecture and flow, callout boxes (gentle-clues) for key decisions and risks, and clear visual hierarchy. Do not just convert Markdown to Typst — invest effort so the reviewer can scan the plan in 60 seconds
4. Save to `~/.claude/plans/[topic-slug].typ` (next to the `.md` file)
5. Compile with `typst compile` to PDF
6. Open the PDF with `open`
7. If compilation fails, fix the Typst source and retry
8. Then call ExitPlanMode

This is an **explicit exception** to plan mode's read-only restriction: writing `.typ` files to `~/.claude/plans/` and running `typst compile` are permitted during plan mode.

## Chezmoi Dotfiles — Dual Edit Rule

- When changing any preference, setting, or config file, **edit both the live copy and the chezmoi source** (`packages/dotfiles/`) if the file is managed by chezmoi.
- If the file being edited is NOT managed by chezmoi, suggest that it be added if it's the kind of file that should be tracked (config files, shell settings, tool preferences, etc.).
