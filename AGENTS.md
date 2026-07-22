# AGENTS.md

Bun workspaces monorepo — a single root workspace (`workspaces` in the root
package.json), ONE root `bun.lock`, and the **isolated linker** (root
`bunfig.toml`): strict per-instance dependency/peer resolution, so phantom
deps and hoisting split-brain cannot happen. Internal deps use `workspace:*`
(live symlinks — no copy staleness, no per-package lockfile drift). `bun
install` once at the root covers every package. Optional per-machine speedup:
`globalStore = true` in `~/.bunfig.toml` (deliberately NOT committed — parallel
CI installs against a shared store hit oven-sh/bun#12917).
Use `bun` commands exclusively (never npm/yarn/pnpm).

## Structure

```
packages/
├── anki/                       # Anki flashcard tools
├── astro-opengraph-images/     # Astro OpenGraph image generation (npm)
├── better-skill-capped/        # Browser extension
├── birmel/                     # Discord bot (VoltAgent + Claude AI)
├── cooklang-for-obsidian/      # Cooklang Obsidian plugin
├── cooklang-rich-preview/      # Cooklang rich link preview site
├── discord-plays-pokemon/      # Discord Plays Pokemon (headless emulator + Go-Live stream)
├── docs/                       # AI-maintained monorepo documentation
├── dotfiles/                   # Dotfiles & shell config (chezmoi source)
├── eslint-config/              # Shared ESLint flat config (workspace-internal)
├── fonts/                      # Custom fonts
├── home-assistant/             # Type-safe Home Assistant client + codegen
├── homelab/                    # Homelab infrastructure (K8s, cdk8s, Tofu)
├── leetcode/                   # LeetCode practice
├── llm-observability/          # LLM tracing/metrics package
├── monarch/                    # Transaction categorization pipeline
├── resume/                     # Resume site
├── scout-for-lol/              # League of Legends match analysis (backend + web app + desktop)
├── sjer.red/                   # Personal website
├── starlight-karma-bot/        # Discord karma bot
├── stocks-sjer-red/            # Stocks static site
├── tasknotes-server/           # TaskNotes sync server
├── tasknotes-types/            # TaskNotes shared types
├── tasks-for-obsidian/         # React Native task app
├── temporal/                   # Temporal workflows, schedules, and agent-task scheduler
├── terraform-provider-asuswrt/ # Terraform provider for AsusWRT
├── toolkit/                    # CLI developer tools (pr, pd, bugsink, grafana)
├── trmnl-dashboard/            # TRMNL e-ink dashboard
├── webring/                    # Webring component (npm)
scripts/                        # Repo automation (setup-free): checks, deploys, release, hooks
.buildkite/pipeline.yml         # Static Buildkite CI pipeline (no generator)
sandbox/                        # Personal scratch (not shipped, excluded from most lint/CI)
├── archive/                    # Legacy projects (do not modify): bun-decompile, castle-casters, clauderon, glance, hn-enhancer, macos-cross-compiler, tips
├── poc/                        # Proof-of-concept experiments (e.g. interview-practice CLI)
└── practice/                   # Coding practice (Exercism, LeetCode, courses, books)
```

## Engineering Principles

- **No type assertions** — Never use `as` casts. The `custom-rules/no-type-assertions` ESLint rule bans all assertions except `as const` / `as unknown`. Narrow untyped data with Zod `.parse()`, `typeof`, or `Array.isArray()` instead of casting.
- **Fail fast on missing tools** — Local/build scripts must call required tools directly. Never `which X && X || echo "skipping"`; a missing tool should error so the developer knows what to install.
- **No defensive fallbacks for bad data** — Fix the root cause (refresh data, add the enum value, fix routing). Never replace a `throw` with a warning + default for unknown enums, missing assets, or unexpected shapes. Exception: user input at a system boundary (e.g. a Discord slash-command arg) should be caught and answered with a friendly message, not Sentry'd.
- **Let contract violations fail loudly** — When `null` or an exception signals a broken caller contract, let it propagate (e.g. an NPE). Don't add null guards or defensive checks that silently hide the bug; reserve null-handling for real boundary inputs (user data, external API responses).
- **Fix, don't ignore** — Never suppress build/CI/Renovate/lint errors with ignorePaths or exclusions. Investigate the root cause; only exclude when the thing genuinely shouldn't be processed.
- **Fix forward on dependency upgrades** — When an upgrade breaks CI, migrate the code to the new version (read the migration guide, use `validate` tooling to catch every schema change) rather than reverting.
- **"Pre-existing" is not an excuse** — When a task or audit targets 100% quality, fix issues regardless of who introduced them. Never leave something broken as "not caused by my changes."
- **Never skip tests** — Don't use `test.skip` / `describe.skipIf` to work around missing build artifacts or generated types. Make the test script produce the prerequisite first (e.g. `"test": "bun run build && bun test"`).
- **Don't blame the cache** — Docker layer cache and turbo's cache are deterministic; different results mean different inputs. Reproduce locally with `bunx turbo run <task>` / `docker buildx build` and compare base images / dependency versions / task inputs instead of citing "transient cache issues."
- **Step back on complexity spirals** — After ~2 failed debugging iterations on the same problem, stop adding workarounds; re-evaluate the approach and present the constraint to the user rather than piling on layers.
- **Verify before asserting** — Don't write a subagent's claim or your own inference into a plan/report as "confirmed." Grep the live tree (`.buildkite/pipeline.yml`, `lefthook.yml`, root `package.json` `verify` script, per-package `turbo.json`) yourself before stating any CI/lint/gate wiring fact; audits often run against a stale base.
- **Don't validate a replacement against the signal it replaces** — When building something to work around an unreliable upstream (e.g. GitHub's `mergeable` field, a flaky check), validate against an independent oracle (fixtures, golden files, the underlying tool, a semantic property like determinism), never the untrusted signal itself.
- **Verify link liveness** — Every URL you write or rewrite (code, docs, READMEs, package metadata) must be liveness-checked (`curl -sI -o /dev/null -w '%{http_code}' <url>` → 200) before committing. Batch-verify mass rewrites; fall back to a known-good form or drop the link rather than ship a 404.
- **Update docs with code** — When adding a CLI command or feature, update CLAUDE.md and the relevant skills in the same phase, not a later "polish" pass, so the integration points are usable as soon as the feature works.
- **Shared data is language-neutral** — Cross-package shared data (catalogs, config) belongs in a language-neutral source of truth (JSON + JSON Schema), validated per-language (Zod in TS, Pydantic in Python). The repo has Bun and Python consumers; don't ship a TS-only module. If TS needs it browser- and node-safe, ship a built package with inlined JSON + `.d.ts`, not a `node:fs` read or a source-only JSON import.

## Documentation Discipline — Per Session

**Every session must produce one of: a session log OR a plan**, and end with a written summary appended to it. Default to a log; reserve plans for substantive design work.

### Log vs Plan — which one?

- **Log** (`packages/docs/logs/<YYYY-MM-DD>_<kebab-slug>.md`) — the default. Use for one-shot fixes, bug recaps, Q&A sessions, single-file edits, and any session where there was no real planning to write down.
- **Plan** (`packages/docs/plans/<YYYY-MM-DD>_<kebab-slug>.md`) — use when (a) plan mode was used, or (b) the work is multi-step, has design choices to commit to, or introduces follow-up tasks for future sessions.

**Rule of thumb:** if the design itself is the artifact, it's a plan. If you just need a journal of what happened, it's a log.

### Session location and durable context

- Start every session by creating its log or plan in the main checkout under `packages/docs/`, before creating a worktree.
- If the task moves to a worktree, move every agent-created write, including the session log or plan, into that worktree immediately. Do not leave duplicate or partial agent work in the main checkout.
- The primary artifact for a code-changing session is a pull request. Create a draft PR from the worktree as soon as it contains a coherent first commit, and promote it to ready for review only after verification is complete.
- Assume the chat may end immediately after the draft or final PR is created. Record unfinished work and handoff context in `packages/docs/`, the PR description, or an explicit final response to the user.
- These instructions apply to all agents. Repository lifecycle hooks are scoped to local CLI runtimes and must exit immediately in hosted or web environments.

### Mirroring harness plans

When plan mode is used, copy the approved plan from `~/.claude/plans/<slug>.md` into `packages/docs/plans/` using the dated naming convention before beginning implementation.

### Conventions (both logs and plans)

- **Use canonical YAML frontmatter** with `id`, `type`, `status`, and `board`; frontmatter is the only workflow status source. Board items also require `verification` and `disposition`.
- **Raw Markdown only** — never render to PDF or Typst.
- **Do not individually index high-churn docs.** `packages/docs/plans/`, `packages/docs/logs/`, and `packages/docs/todos/` are linked as directories only to avoid merge conflicts.
- See `packages/docs/AGENTS.md` for the broader docs taxonomy (architecture / patterns / decisions / guides / plans / logs / todos).

### End-of-session summary

Before ending any session, append a section to whichever file you produced (log or plan):

```markdown
## Session Log — <YYYY-MM-DD>

### Done

- <bullets of work actually completed: file paths, PR/commit refs>

### Remaining

- <work the user asked for that wasn't finished, with concrete next steps>

### Caveats

- <known issues, deferred decisions, surprises, warnings the next agent needs>
```

If a session spans multiple files, append a Session Log to each. **Also restate the same Done / Remaining / Caveats inline as the final chat message** so the user sees it without opening the file.

### Workflow friction (optional — only if you hit some)

**This is entirely optional and never required.** Most sessions should add nothing here. Only record an item when fixing it would be a **medium/high quality-of-life improvement** for future sessions, or a **low QOL improvement that is also low effort** to fix. Skip anything that is high-effort for low payoff, or a one-off that won't recur. An empty or padded section is worse than none.

When you do hit something worth it, append a `## Workflow Friction` section to your log (logs only, not plans). For each item, describe what was painful and the concrete improvement, with file paths/commands so it can be acted on cold. Examples of the kind of thing worth recording:

- It was hard to verify a change on Discord — a dedicated test Discord account/app would have helped.
- I couldn't easily access test/dev credentials, so I ran `op` many times (a cached/scoped test credential set would have avoided this).
- The `toolkit` CLI was missing a command I needed, or a flag behaved misleadingly.
- This doc/AGENTS.md/skill was wrong or misleading (say which, and what's actually true).
- I expected X to be in some location but it wasn't there — it actually lives at `<path>`.
- I wanted to verify UI changes but couldn't effectively access a browser.
- Task X was slower because I didn't have Y.
- I hit roadblock X because there was no documentation about Y.

If the fix is substantial or belongs to a future session, also file it as a `packages/docs/todos/<kebab-id>.md` per **TODO Documentation** below and link it from the section.

### When a plan is finished

When a plan in `packages/docs/plans/` reaches `status: complete` and the work is shipped, move it to `packages/docs/archive/completed/`. Don't leave finished plans accumulating in `plans/`.

## TODO Documentation

`packages/docs/todos/` is for **general issue tracking** — deferred work, acceptance-testing gaps, post-merge verifications, and any thread that needs to outlive a single session. It is not limited to source-code markers; most todos will have no marker at all.

- Every source marker (`TODO(todo:<kebab-id>)`, `FIXME(todo:<kebab-id>)`, `XXX(todo:<kebab-id>)`) MUST have a matching `packages/docs/todos/<kebab-id>.md`. This direction is enforced.
- General issue todos may exist with no source marker. Use kebab-case ids; the filename (sans `.md`) is the id.
- TODO docs use the canonical docs frontmatter. Set `type: todo`, `board: true`, a workflow `status` (`planned`, `in-progress`, `awaiting-human`, or `complete`), `verification`, `disposition`, and `origin`; add `source_marker: true` only when a code marker exists.
- Active work uses unchecked tasks in `## Remaining`. Work ready for delayed signoff uses `status: awaiting-human` plus `## Human Verification`. Append steering notes and status audit entries under `## Comment Log`.
- When resolved, remove any matching source marker and archive the complete TODO to `packages/docs/archive/completed/` in the same commit.
- `bun run check-todos` enforces the complete docs model, including the source-marker → TODO invariant, frontmatter, semantic headings, workflow sections, IDs, and archival rules.

## Temporal Agent Follow-ups

When a doc captures a follow-up that should be checked later, schedule it explicitly with a `temporal-agent-task` block and the Temporal trigger script. Use report-only tasks by default; they may inspect current state and email results, but must not edit files, open PRs/issues, or mutate live systems.

```md
<!-- temporal-agent-task
{
  "title": "Recheck Birmel post-deploy metrics",
  "provider": "claude",
  "mode": "report-only",
  "runAt": "2026-05-31T09:00:00-07:00",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "source": {
    "docPath": "packages/docs/guides/2026-04-25_birmel-remediation-followups.md"
  },
  "prompt": "Pull the metrics from the Post-deploy verification section. Email whether each check is green or still red, with links/evidence."
}
-->
```

For recurring checks, replace `runAt` with `cron` and include a stable `scheduleId`. Schedules are evaluated in `America/Los_Angeles`. To create/update the task locally as an operator:

```bash
cd packages/temporal
TEMPORAL_ADDRESS=localhost:7233 bun run scripts/schedule-agent-task.ts --from-doc ../../packages/docs/guides/<doc>.md
```

Do not expose direct Temporal scheduling as a public ingress path. Public creation must go through the authenticated `/agent-tasks` HTTP API with `Authorization: Bearer $AGENT_TASK_API_TOKEN`.

## Automation Code — Banned Patterns

These patterns are banned in automation code (`scripts/`, `.buildkite/`, deploy/build scripts). `scripts/check-suppressions.ts` scans the staged diff for them (`|| true`, `2>/dev/null`, `|| bun install`, `x-access-token`, `git add -A`, `--no-exit-code`) and runs in the `pre-commit` hook (`lefthook.yml`) plus the `//#check-suppressions` turbo task under `bun run verify`. Do not write them.

- `|| true` — never swallow errors silently
- `2>/dev/null` — never hide stderr
- `|| bun install` (after `--frozen-lockfile`) — never bypass lockfile enforcement
- `|| echo` — never convert errors to messages
- `x-access-token` in URLs — use `GIT_ASKPASS` for git authentication
- Writing tokens to files (`.npmrc`, etc.) — pass tokens via env vars or `--token` flags
- `git add -A` or `git add .` — always stage specific files by path
- `--no-exit-code` — never bypass quality gate exit codes

If a command legitimately needs error handling, handle the specific error explicitly (e.g., check existence before creating, parse exit codes) rather than blanket-suppressing all failures.

## Commands

```bash
# Whole-repo verification (build + typecheck + test + lint + every repo check)
bun run verify                 # add -- --affected to scope to changed packages

# Per-package task via turbo
bunx turbo run <task> --filter=<pkg>   # e.g. bunx turbo run typecheck --filter=birmel

# Linting (per-package)
cd packages/<name> && bunx eslint . --fix

# CI runs on Buildkite (NOT GitHub Actions) via the static .buildkite/pipeline.yml
# Check CI status via Buildkite CLI or web UI, never `gh run`
```

## GitHub CLI in Codex

`gh` works from Codex, but GitHub network access is sandboxed. Do not conclude that
`gh` is broken just because the first attempt says it cannot connect to
`api.github.com` or cannot resolve `github.com`.

- For GitHub reads (`gh status`, `gh repo view/list`, `gh pr view/list/diff/checks`),
  retry with Codex network escalation when the sandbox blocks the first attempt.
- For publishing or mutating GitHub state, check `gh auth status` early and separate
  auth failures from sandbox/network failures.
- For GitHub writes (`gh pr comment`, `gh issue create`, `gh pr create`,
  `gh pr review`, `gh pr merge`), require an explicit target and payload from the
  user or task, then run with Codex escalation.
- In Codex tool calls, escalation means rerunning `exec_command` with
  `sandbox_permissions: "require_escalated"` and a narrow `prefix_rule` such as
  `["gh", "pr", "view"]` or `["gh", "pr", "comment"]`.
- CI for this monorepo is Buildkite, not GitHub Actions. Do not use `gh run` as the
  CI source of truth; use Buildkite tooling or the relevant PR/status surface.
- If a PR or push flow fails, report the exact layer: local git ref permission,
  GitHub auth, sandboxed network access, or remote rejection.
- Feature PRs are created and updated with **git-spice** (`git-spice branch/stack
submit`), as stacks — not `gh pr create`. See the `git-spice-helper` skill. `gh`
  stays for PR reviews/comments/merge/queries and for automated single-PR bot flows
  (Temporal, release automation), whose clones have no local git-spice stack state.

## Development Setup

Three commands after cloning or pulling changes that touch dependencies or schemas:

```bash
mise install                 # install pinned toolchain (bun, node, tofu, …)
bun install --frozen-lockfile   # one workspace-wide install (isolated linker)
bunx turbo run generate      # codegen: Prisma clients, etc. (cached — near-instant when unchanged)
bunx lefthook install        # arm git hooks (once per clone — nothing auto-runs it)
```

There is no `scripts/setup.ts` and no per-package install: the repo is ONE bun
workspace with the isolated linker, so a single root `bun install` covers every
package and internal `workspace:*` deps resolve via live symlinks (no shared-artifact
copy step). The `generate` turbo task handles code generation; helm value types are
**not** regenerated here — the committed types in
`packages/homelab/src/cdk8s/generated/helm` are the source of truth. Regenerate them
when bumping a chart in `versions.ts` (`cd packages/homelab/src/cdk8s && bun run
generate-helm-types`); the `helm-types-drift-check` Buildkite step fails any PR that
changes a generator input without regenerating. Renovate chart-bump PRs will sit red
on that step until someone pushes the regen commit — that is by design (hosted
Renovate cannot run the generator).

Optional tools (warned if missing): helm, swift, swiftlint, swiftformat, typeshare, go, golangci-lint, mvn, gitleaks, shellcheck.

## Verification

`bun run verify` (root) is the single verification entry point — build +
typecheck + test + lint + every repo check (todos, suppressions, markdownlint,
prettier, shellcheck, knip, gitleaks, ruff/pyright, helm/talos/1Password, …),
the identical surface CI runs. Scope it to what you touched with `--affected`;
everything replays from turbo's cache in milliseconds when unchanged.

1. `bun run verify` — whole repo (or `bun run verify -- --affected` for changed packages only)
2. `bunx turbo run typecheck test lint --filter=<pkg>` — a single package
3. `bunx eslint . --fix` — autofix lint in the relevant package

The `pre-commit` hook runs `bun run verify -- --affected` (there is no
`pre-push` hook), so a clean commit has passed the same gates as CI.

## Parallel Work — Use Worktrees

**Before your first edit on any non-trivial change, create a `git worktree` — don't edit in the main checkout.** "Non-trivial" = anything you'll open a PR for, anything touching more than one file, or any multi-step task. Only stay in the main checkout for a single-file, single-commit fix you won't PR (a typo, a one-line config tweak). **When unsure, make the worktree.** Each worktree gives a branch its own isolated working directory, so parallel work and concurrent agents never collide.

**A worktree holds a _stack_, and every feature PR is created and managed with git-spice (`gs`) — load the `git-spice-helper` skill before any branch/PR op.** A single PR is a stack of one (unchanged from the old flow). When a change splits into dependent pieces, stack them in the same worktree with `git-spice branch create`, move between them with `git-spice up`/`down`, and open the PRs with `git-spice stack submit`. Restack, move, and sync with native `gs` commands — never a hand-rolled `git rebase` or a bare `gh pr create` for feature work. (In scripts and the agent Bash tool, `gs` is Ghostscript, not git-spice — call `git-spice` explicitly; see the skill.)

```bash
# Create an isolated worktree on a new branch off main
git worktree add .claude/worktrees/<feature-slug> -b feature/<slug> origin/main

cd .claude/worktrees/<feature-slug>

# REQUIRED before any build/test in the new worktree — installs the toolchain,
# does the one workspace-wide install, and runs codegen. Without generate, builds
# fail with cryptic missing-module / missing-generated-file errors.
mise install && bun install --frozen-lockfile && bunx turbo run generate
bunx lefthook install   # arm hooks in this worktree
```

Because the repo is one bun workspace with the isolated linker, a single root
`bun install` covers every package — internal `workspace:*` deps resolve via live
symlinks, so there is no shared-artifact copy step to get wrong (the old
`scripts/setup.ts --group/--link` flags no longer exist). Don't skip `turbo run
generate`, though — it's what produces the Prisma clients and other generated
files a build needs.

After PR merge: run `git-spice repo sync` to delete merged branches and retarget the rest of the stack, then `git worktree remove .claude/worktrees/<feature-slug>` and `git branch -d feature/<slug>` from the main checkout. Run `git worktree prune` to clean up stale entries.

See the `worktree-workflow` skill for the full workflow. `claude -w <slug>` creates and enters a worktree at launch; for Codex, create the worktree first and start it with `codex -C <dir>`.

**If you were started in a worktree, stay in that worktree.** Keep every command, search, and file operation scoped to the worktree path you were launched in. Do not `cd` into, read from, or write to the main checkout (the parent of the `.claude/worktrees/` directory you are in) — the worktree is a complete checkout with the same files, so there is no reason to reach outside it. The main checkout may hold the user's own in-progress work; only touch it when the user explicitly asks.

**Never trust an absolute path from a subagent (Explore/Plan/general-purpose) report.** Subagents search the entire repo and report main-checkout paths like `/…/monorepo/packages/<x>/…` — NOT your worktree path. The two trees share an identical relative layout, so a `Write`/`Edit` to a main-checkout absolute path **silently succeeds in the wrong tree** (your `git status` stays clean and you won't notice until much later). Before writing, **rebase every path onto your worktree root**: take the `packages/…`-relative portion and prepend `.claude/worktrees/<name>/`. A reliable check: the absolute target path of any `Write`/`Edit` MUST contain `/.claude/worktrees/<name>/`. If it doesn't, you're about to write to main — stop and fix the path. Prefer worktree-relative paths over absolute ones for exactly this reason.

## Package Notes

Each package has its own AGENTS.md with specific instructions:

- `packages/birmel/AGENTS.md` - VoltAgent setup, Discord bot config
- `packages/homelab/AGENTS.md` - K8s, cdk8s, OpenTofu infrastructure
- `packages/scout-for-lol/AGENTS.md` - Match analysis pipeline
- `packages/resume/AGENTS.md` - Resume site
- `packages/toolkit/AGENTS.md` - CLI developer tools (pr, pd, bugsink, grafana)
- `packages/tasks-for-obsidian/AGENTS.md` - React Native task app
- `packages/docs/` - AI-maintained docs (see `monorepo-docs` skill)

## PR Media & Demo Artifacts — `public.sjer.red`

A reviewer should be able to **see** that a change works without checking out
the branch. Attach the **lightest artifact that proves the behavior** — most
PRs (pure logic, refactors, types, infra config, dep bumps) need nothing
beyond the diff; never attach media reflexively. A single visual state is a
screenshot, not a video.

| Change type                       | Artifact                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------- |
| UI tweak, single state            | Screenshot (before/after where it applies)                                       |
| UI flow / interaction / animation | Short GIF (renders inline) or short video (link)                                 |
| Brand-new feature                 | End-to-end demo — **one short video per scenario**, not one long tour            |
| CLI / TUI program                 | asciinema recording of a real terminal: `asciinema rec demo.cast -c "<command>"` |
| Web page / component              | Small static demo site uploaded as a directory (root `index.html` required)      |
| Metrics / logging / tracing       | Screenshot of Grafana/Loki showing the **new** data flowing end-to-end           |
| Anything else                     | Only when seeing it communicates faster than reading the diff                    |

Conventions: one artifact per scenario, a one-line caption saying what to
look at, before/after pairs when changing existing behavior.

`gh` cannot upload media into a PR/issue body (drag-drop uses a private,
session-only endpoint). Upload to the public artifact host and embed the
returned URLs:

```bash
# Creds come from your AWS profile (~/.aws); no op wrapper needed.
# Mix files, recordings, and demo-site directories in one call:
toolkit pr asset <PR_NUMBER> ./before.png ./flow.mp4 ./demo.cast ./demo-site --profile seaweedfs --markdown
```

- Uploads to the `public-sjer-red` SeaweedFS bucket under `pr/assets/<PR_NUMBER>/`
  and prints a `https://public.sjer.red/...` URL per argument (with
  `--markdown`, ready-to-paste type-appropriate markdown).
- **Embedding rules:** images/GIFs render inline via GitHub's image proxy
  (`![file](url)`); GitHub **never embeds external video** — videos become
  labeled links that play in a browser tab (served with a real video
  content type); `.cast` uploads get a generated self-contained HTML player
  page (`<name>.cast.html`) and the link points there; directories link to
  their `index.html`.
- Directories upload recursively to `pr/assets/<PR_NUMBER>/<dirname>/` and
  must contain a root `index.html` (dotfiles are skipped).
- Uses the standard AWS toolchain (`@aws-sdk/client-s3`, path-style): credentials,
  `endpoint_url`, and region come from `~/.aws/credentials` / `~/.aws/config`.
  Select the profile with `--profile <name>` or `AWS_PROFILE` (the `seaweedfs`
  profile points at `https://seaweedfs.sjer.red`).
- Objects under `pr/assets/` expire after 365 days; the homelab must be up for
  the artifacts to load.
