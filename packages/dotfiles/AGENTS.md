# Global Agent Instructions

## Tool & Skill Usage — MANDATORY

Before doing ANY work, scan the available skills list for relevant skills and LOAD THEM. This is not optional.

- **ALWAYS load matching skills first** - If the task involves a technology that has a skill (Docker, Terraform, Kubernetes, Git, TypeScript, etc.), load that skill BEFORE taking any action. Do not attempt to solve the problem without the skill.
- **Use supported CLIs first** - Prefer `linear`, `posthog-cli`, `gh`, and `git-spice` for service and workflow operations. Do not introduce package-local MCP configuration; use MCP only when a user explicitly selects a top-level integration.
- **Leverage plugins** - Check available plugins before implementing something from scratch
- **Web access — lightpanda, PinchTab, Docling, or similar** - For plain page/docs fetches, use [Lightpanda](https://github.com/lightpanda-io/browser): `lightpanda fetch --dump markdown --strip-mode full --log-level fatal <url>` (see the `lightpanda-browser` skill). For sites that block Lightpanda or need interaction (clicking, form filling, screenshots), use [PinchTab](https://github.com/pinchtab/pinchtab) — load the `pinchtab-helper` skill first. For document extraction (PDF/DOCX/etc.), use [Docling](https://github.com/docling-project/docling) per the PDF Extraction section below. Other similar tools are fine when they fit better.
- **Look deeper** - If CI is failing, a build tool is erroring, or infrastructure has issues, don't just report the surface error. Load the relevant skill and investigate the root cause. The user wants solutions, not descriptions of problems.
- **Branch & PR management → load the branching skill first.** Before creating branches, opening/updating/stacking/moving PRs, restacking, or syncing a branch with main, load the repo's branching skill first. In `shepherdjerred/monorepo` that is `git-spice-helper`. **Proactively split all work into shallow, clean Git Spice stacks** (e.g., types/contracts in PR 1, backend logic in PR 2, UI in PR 3; or refactors first, then features). Do not run `git branch`, `git checkout`, `git rebase`, `gh pr create`, or bare `gs` for feature work before loading the skill.

Examples of what NOT to do:

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

## Credentials in Chat

- Treat credentials pasted into a private chat as sensitive input, but do not assume they are compromised merely because they appear in a chat transcript.
- Use them only as needed for the requested operation; never repeat secret values in responses, logs, durable files, memory, commits, or generated artifacts.
- Recommend rotation when a credential was posted publicly or shared broadly, persisted outside the intended private transcript, or shows signs of misuse. Do not reflexively demand rotation solely because the user pasted it into a private chat.

## Pull Requests — Mandatory Visual Proof & Demos

Reviewers should never have to pull a branch and run it locally to see what a change looks like or how it behaves. **Every PR where a visual demonstration aids review MUST include rich visual evidence directly in the PR description or a PR comment.**

- **Documentation & Wiki (`packages/docs/wiki/`)**: Run the local preview (`bun run dev`) or build and capture a screenshot of rendered pages (e.g., via PinchTab, browser automation, or browser DevTools) showing the article layout, callouts, tables, and images in context.
- **Web Apps & UI Features (`sjer.red`, `scout-for-lol`, `stocks-sjer-red`, `trmnl-dashboard`, `resume`, `tasks-for-obsidian`)**: Provide an end-to-end interactive demo — capture screenshots of key states, responsive views, before/after comparisons, animated GIFs, or screen recordings demonstrating the complete user journey.
- **Bots & Messaging (`birmel`, `discord-plays-pokemon`, `starlight-karma-bot`)**: For every new user-facing Discord message — including embeds, components, replies, errors, and other visible output — include an example in the PR description. Prefer real output rendered in Discord and captured in a screenshot; if real rendering is unavailable, include the exact plaintext message or representative embed/component content instead.
- **CLI, TUI & Developer Tools (`toolkit`, `monarch`, shell utilities, dotfiles)**: Record terminal sessions using [asciinema](https://asciinema.org) (`asciinema rec demo.cast`), generate animated SVG/GIF recordings, or capture formatted ANSI terminal output showing the tool in action.
- **Generated Graphics, Fonts & OpenGraph (`astro-opengraph-images`, `fonts`, email templates)**: Render the image, OG card, font sample, or PDF directly and attach the generated asset.
- **Multi-State Coverage**: When a feature introduces multiple UI or workflow states (e.g., empty state, loading state, error dialog, success confirmation, dark and light themes), capture and attach visual proof for each scenario.
- **Non-visual changes**: Pure backend logic, type-only changes, or internal refactors with zero user-observable visual output do not need media, but should still document verification commands.

## Git-Spice PR Stacking — Split PRs Proactively

In `shepherdjerred/monorepo`, feature work is managed with [git-spice](https://abhinav.github.io/git-spice/) (`toolkit git-spice`). **Agents must proactively decompose complex or multi-concern changes into shallow, clean stacked PRs** rather than opening a single monolithic PR:

- **Layered Architecture**: Split by architectural boundary (e.g., Schema / Zod types / API contracts in branch 1 → backend service / business logic in branch 2 → frontend UI components / views in branch 3).
- **Refactor + Feature**: Isolate prerequisite cleanups, mechanical migrations, or dependency adjustments into a foundation PR before stacking the new feature logic on top.
- **Infra/Config + Consumer**: Land infrastructure definitions (cdk8s, Tofu, Helm, feature flags) in a base PR before stacking application consumers that depend on them.
- **Documentation & Tests**: Stack significant wiki articles, runbooks, or extensive integration test harnesses alongside or immediately on top of feature code.
- **Stacking Constraints**:
  - Keep stacks shallow (typically ≤ 4–5 branches).
  - Every PR in the stack must be independently landable and pass CI (`buildkite/monorepo/pr`). Feature-flag incomplete features if needed.
  - Every PR must have its own Conventional Commit title, clear `Why`/`What`/`Verification` narrative, and corresponding visual demo where applicable.

## Engineering Principles

These apply to all work — code, infrastructure, configuration, CI pipelines, scripts, and system design.

- **Fail fast** — Surface errors immediately. Never swallow exceptions, ignore error return values, or silently fall back. If something is wrong, crash or throw at the point of failure. This applies equally to shell scripts, CI pipelines, Kubernetes manifests, and application code.
- **Never use type assertions** — No `as` casts (except `as const` and `as unknown` which the ESLint rule allows). Use runtime validation (Zod `.parse()`, `Array.isArray()`, `typeof`) or proper type narrowing instead. More broadly: never lie to a type system or validation layer — if the types don't fit, fix the data or the design, not the types.
- **Strong, static typing** — Leverage type systems fully. No `any`, no implicit `any`, no loose types. Precise function signatures, return types, and data structures. This extends beyond TypeScript: use strict schemas for config (Zod, JSON Schema, Helm values types), typed IaC (cdk8s, CDKTF over raw YAML), and validated inputs at every system boundary.
- **Temporal for all scheduled and recurring workloads** — Author all recurring jobs, maintenance tasks, data syncs, and scheduled batch operations as Temporal Workflows and declarative Schedules in `packages/temporal` (`src/schedules/schedule-definitions.ts`). Never introduce Kubernetes `CronJob`s (`batch/v1 CronJob` / CDK8s `KubeCronJob`), host crontabs, or ad-hoc in-process timers.
- **Quality is paramount** — Never take shortcuts. No TODO hacks, no "good enough for now" workarounds, no skipped edge cases. Write correct, complete solutions the first time — whether that's code, a Helm chart, a CI pipeline, or a database migration.
- **Take the time you need** — Use as many tokens and tool calls as necessary to complete a task properly. Never rush or cut corners to save tokens. Investigate thoroughly, verify end-to-end, and get it right.

## Waiting on CI / PRs / external state — never busy-poll

- **Never poll with `sleep N && <cmd>`** (e.g. `sleep 90 && gh pr checks`). The harness blocks sleep-then-command, so these calls just fail and waste turns. Foreground `sleep` to "wait" is also blocked.
- To wait on something that changes over time, use the right mechanism instead:
  - **PRs / CI** → use the repository's `git-spice-helper` workflow for branch and PR operations; use `gh`/Buildkite directly for read-only status checks.
  - **A condition you can re-check** → the `Monitor` tool (an until-loop), or a **background Bash task** (`run_in_background: true`) that re-invokes you when it exits.
  - **A fixed future time / recurring check** → `ScheduleWakeup` (dynamic `/loop`) or a scheduled agent.
- Harness-tracked background work (background Bash, spawned agents, workflows) re-invokes you on completion — do **not** add a short-interval poll to check on it.

## Research Preferences

- When researching topics, emphasize **GitHub**, **Hacker News**, and **Wikipedia** as primary sources.
- Prefer a mix of authoritative first-party sources (official docs, Wikipedia, project READMEs) with real-world anecdotes and discussion from Hacker News.

## Plan Mode — Raw Markdown Only

In plan mode, write plans as raw Markdown to the plan file. Do **not** convert plans to Typst or PDF — the `.md` file is the deliverable. Keep plans scannable with tables, headings, and concise bullet points directly in Markdown.

## Typst Files — Always Render to PDF

When asked to show, display, or present a `.typ` file, **always render it to PDF and open it** rather than just showing the source. Steps:

1. Compile with `typst compile <file>.typ`
2. Open the resulting PDF with `open <file>.pdf`
3. If compilation fails, fix the Typst source and retry

Never just print or read Typst source as the final output — the user wants to see the rendered result.

## Calculations — Always Use Code

- For any math, logic, counting, date calculations, or deterministic work, **write and run a Python or Bun script** via Bash. Never compute answers mentally.
- This includes simple arithmetic — always verify with code.

## PDF Extraction — Use Docling

For PDF to text/markdown conversion, use **Docling**. It handles tables, formulas, OCR, reading order, and complex layouts out of the box.

```bash
docling input.pdf                              # CLI — outputs markdown
docling --to md --output ./out/ input.pdf      # Explicit markdown output
docling-tools models download                  # Refresh standard local models
```

```python
from docling.document_converter import DocumentConverter
doc = DocumentConverter().convert("input.pdf").document
print(doc.export_to_markdown())
```

- **Docling Serve** for API deployment
- **Docling MCP** for agent integration
- Supports: PDF, DOCX, PPTX, XLSX, HTML, images, audio, LaTeX
- Installed persistently by chezmoi as an isolated `uv tool` with the useful
  macOS OCR, VLM, ASR, HTML, XBRL, and remote-client extras. Do not install it
  into a repository environment.
- MIT license, LF AI & Data Foundation project

## Chezmoi Dotfiles — Dual Edit Rule

- When changing any preference, setting, or config file, **edit both the live copy and the chezmoi source** (`packages/dotfiles/`) if the file is managed by chezmoi.
- If the file being edited is NOT managed by chezmoi, suggest that it be added if it's the kind of file that should be tracked (config files, shell settings, tool preferences, etc.).

## Homebrew — the Brewfile is generated, not authored

- `.Brewfile_darwin` / `.Brewfile_linux` are **rewritten from installed state** by
  `bin/write_brewfile.sh` (`rm -f` then `brew bundle dump`). Hand-written lines and
  hand-written comments do not survive — the comments you see are Homebrew's own
  `brew desc` output. Rationale belongs here or in `MACOS_FRESH_INSTALL.md`.
- To add a package: `brew install` it, then run `~/bin/write_brewfile.sh`, then
  `chezmoi apply`. Never hand-edit the manifest.
- Third-party taps additionally need an entry in `install_macos.sh`'s
  `third_party_formulae` array, or `brew bundle` aborts on an untrusted formula
  during a fresh install.
- **One channel per tool.** `bun`, `node`, `go`, `java`, `rust`, and `python` are
  mise-managed (`.mise.toml`, `~/.config/mise/config.toml`). Never `brew install`
  or `cargo install` them — the dump records the duplicate, and the mise shim wins
  PATH, so you get a shadowed second copy that silently drifts.

## Spotlight exclusions — declared in data, placed by a script

- The excluded directories live in `.chezmoidata/spotlight.yaml`; the markers are
  placed by `run_after_configure-spotlight-exclusions.sh.tmpl`. **Edit the YAML,
  never the marker files** — add a path relative to `$HOME` and it takes effect
  on the next `chezmoi apply`.
- The markers are **not** chezmoi-managed files, deliberately. Tracking
  `git/.metadata_never_index` as a target would make chezmoi create `~/git`,
  `~/go`, `~/.gradle` and friends on a fresh machine for toolchains that may
  never be installed. The script only marks directories that already exist.
- It is a plain `run_after_` (every apply), not `run_once_`/`run_onchange_`,
  because package managers delete and recreate their own cache roots and take
  the marker with them. A state-tracked script would not notice, and the
  exclusion would silently decay. Expect it to always show as a pending "new
  file" in `chezmoi diff`, same as `sync-theme.sh`.
- **Do not exclude anything you want to find in Spotlight or Finder search.**
  Source trees are safe to exclude here only because code search goes through
  `rg`/`fd`, which ignore the Spotlight index entirely.
- Adding a large directory to the list does not shrink an already-built index.
  After a significant addition, rebuild once with
  `sudo mdutil -E /System/Volumes/Data`.

## CLI tool boundaries

### Linear and PostHog

`linear` and `posthog-cli` are Homebrew-managed vendor CLIs. Their credentials
are rendered into Fish from the existing 1Password item by
`private_dot_config/private_fish/config.fish.tmpl`:

- Linear reads `LINEAR_API_KEY` and targets the `sjerred` workspace.
- PostHog reads `POSTHOG_CLI_API_KEY` and project `549883`.

After installing or updating the dotfiles, open a new Fish shell or run
`chezmoi apply`, then verify with `linear auth whoami` and
`posthog-cli api call read-data-schema '{"query":{"kind":"events"}}'`.
Never use `linear auth token`, `posthog-cli login`, or ad-hoc dotenv files for
the normal setup: those paths duplicate or expose credentials outside the
1Password-backed environment. Load `linear-helper` or `posthog-helper` before
performing vendor operations; they hold the schema-first workflow, explicit
write boundary, and dated deep references.

- **Cloudflare DNS is OpenTofu-owned.** `cf` (`~/.local/bin/cf`) carries a
  read/write token, but records, zones, and DNSSEC live in
  `packages/homelab/src/tofu/cloudflare/`. Use `cf` to read; make every change
  through Tofu. See `packages/homelab/AGENTS.md`.
- **Never export `TEMPORAL_ADDRESS` globally.** `packages/temporal/scripts/*.ts`
  read it and fall back to localhost, so a global export silently retargets every
  "local" script at production. Use `temporal --profile homelab` instead.
- **Use `toolkit` for observability queries.** Prefer `toolkit prom query`
  for PromQL and the corresponding `toolkit grafana`, `toolkit loki`, or
  `toolkit tempo` passthroughs for those services. This preserves the
  configured datasource, authentication, and agent-friendly output. Use raw
  HTTP only when troubleshooting the toolkit/transport itself or when no
  toolkit command exists.
- **`gcx` owns `~/.config/gcx/config.yaml`.** Chezmoi deliberately does not manage
  it: gcx migrates any inline token into the macOS Keychain and rewrites the file
  on first use. `run_onchange_after_configure-gcx.sh.tmpl` provisions the context
  and re-runs when the 1Password credential rotates.

## macOS Fresh Install — Berkeley Mono

- `install_macos.sh` requires the licensed static Berkeley Mono TTF package to
  be extracted under `~/Downloads`, or supplied through
  `BERKELEY_MONO_SOURCE_DIR`.
- Never commit the licensed source fonts or patched outputs. The bootstrap uses
  `packages/fonts/patch-berkeley-mono.py` to download the pinned Nerd Fonts
  patcher, verify its checksum, patch the external TTFs, and install them into
  `~/Library/Fonts`.
