# Global Agent Instructions

## Tool & Skill Usage — MANDATORY

Before doing ANY work, scan the available skills list for relevant skills and LOAD THEM. This is not optional.

- **ALWAYS load matching skills first** - If the task involves a technology that has a skill (Docker, Terraform, Kubernetes, Git, TypeScript, etc.), load that skill BEFORE taking any action. Do not attempt to solve the problem without the skill.
- **Use MCP tools first** - When MCP servers provide relevant functionality, prefer them over manual approaches
- **Leverage plugins** - Check available plugins before implementing something from scratch
- **Web access — lightpanda, PinchTab, Docling, or similar** - For plain page/docs fetches, use [lightpanda](https://github.com/lightpanda-io/browser): `lightpanda fetch --dump markdown --strip_mode full --log_level fatal <url>` (see the `lightpanda-browser` skill). For sites that block lightpanda or need interaction (clicking, form filling, screenshots), use [PinchTab](https://github.com/pinchtab/pinchtab) — load the `pinchtab-helper` skill first. For document extraction (PDF/DOCX/etc.), use [Docling](https://github.com/docling-project/docling) per the PDF Extraction section below. Other similar tools are fine when they fit better.
- **Look deeper** - If CI is failing, a build tool is erroring, or infrastructure has issues, don't just report the surface error. Load the relevant skill and investigate the root cause. The user wants solutions, not descriptions of problems.

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

## Pull Requests — Show Visual Changes

- When a change has a visible result — UI, web pages, components, charts, generated/OG images, CLI or TUI output, dashboards, rendered docs — **include screenshots (before/after where it applies) in the PR description or a PR comment.** A reviewer should be able to see the visual impact without checking out the branch.
- Attach the actual rendered output (run the app, render the image, screenshot the terminal), not a description of it. When a change affects multiple states or scenarios, attach one screenshot per scenario.
- Non-visual changes (pure logic, infra config, types, refactors) do not need screenshots.

## Engineering Principles

These apply to all work — code, infrastructure, configuration, CI pipelines, scripts, and system design.

- **Fail fast** — Surface errors immediately. Never swallow exceptions, ignore error return values, or silently fall back. If something is wrong, crash or throw at the point of failure. This applies equally to shell scripts, CI pipelines, Kubernetes manifests, and application code.
- **Never use type assertions** — No `as` casts (except `as const` and `as unknown` which the ESLint rule allows). Use runtime validation (Zod `.parse()`, `Array.isArray()`, `typeof`) or proper type narrowing instead. More broadly: never lie to a type system or validation layer — if the types don't fit, fix the data or the design, not the types.
- **Strong, static typing** — Leverage type systems fully. No `any`, no implicit `any`, no loose types. Precise function signatures, return types, and data structures. This extends beyond TypeScript: use strict schemas for config (Zod, JSON Schema, Helm values types), typed IaC (cdk8s, CDKTF over raw YAML), and validated inputs at every system boundary.
- **Quality is paramount** — Never take shortcuts. No TODO hacks, no "good enough for now" workarounds, no skipped edge cases. Write correct, complete solutions the first time — whether that's code, a Helm chart, a CI pipeline, or a database migration.
- **Take the time you need** — Use as many tokens and tool calls as necessary to complete a task properly. Never rush or cut corners to save tokens. Investigate thoroughly, verify end-to-end, and get it right.

## Waiting on CI / PRs / external state — never busy-poll

- **Never poll with `sleep N && <cmd>`** (e.g. `sleep 90 && gh pr checks`). The harness blocks sleep-then-command, so these calls just fail and waste turns. Foreground `sleep` to "wait" is also blocked.
- To wait on something that changes over time, use the right mechanism instead:
  - **PRs / CI** → the `pr-monitor` skill (it drives a PR through reviews and conflicts, plus CI in repos that have it), or `pr-health` for a one-shot status.
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
uv pip install docling
docling input.pdf                              # CLI — outputs markdown
docling --to md --output ./out/ input.pdf      # Explicit markdown output
uvx docling input.pdf                          # One-shot without installing
```

```python
from docling.document_converter import DocumentConverter
doc = DocumentConverter().convert("input.pdf").document
print(doc.export_to_markdown())
```

- **Docling Serve** for API deployment
- **Docling MCP** for agent integration
- Supports: PDF, DOCX, PPTX, XLSX, HTML, images, audio, LaTeX
- MIT license, LF AI & Data Foundation project

## Chezmoi Dotfiles — Dual Edit Rule

- When changing any preference, setting, or config file, **edit both the live copy and the chezmoi source** (`packages/dotfiles/`) if the file is managed by chezmoi.
- If the file being edited is NOT managed by chezmoi, suggest that it be added if it's the kind of file that should be tracked (config files, shell settings, tool preferences, etc.).
