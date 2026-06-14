# AGENTS.md

Bun workspaces monorepo. Use `bun` commands exclusively (never npm/yarn/pnpm).

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
├── eslint-config/              # Shared ESLint rules (npm)
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
├── toolkit/                    # CLI developer tools (fetch, recall, pr, pd, bugsink, grafana)
├── trmnl-dashboard/            # TRMNL e-ink dashboard
├── webring/                    # Webring component (npm)
scripts/ci/                     # TypeScript CI pipeline generator
sandbox/                        # Personal scratch (not shipped, excluded from most lint/CI)
├── archive/                    # Legacy projects (do not modify): bun-decompile, castle-casters, clauderon, glance, hn-enhancer, macos-cross-compiler, tips
├── poc/                        # Proof-of-concept experiments (e.g. interview-practice CLI)
└── practice/                   # Coding practice (Exercism, LeetCode, courses, books)
```

## Documentation Discipline — Per Session

**Every session must produce one of: a session log OR a plan**, and end with a written summary appended to it. Default to a log; reserve plans for substantive design work.

### Log vs Plan — which one?

- **Log** (`packages/docs/logs/<YYYY-MM-DD>_<kebab-slug>.md`) — the default. Use for one-shot fixes, bug recaps, Q&A sessions, single-file edits, and any session where there was no real planning to write down.
- **Plan** (`packages/docs/plans/<YYYY-MM-DD>_<kebab-slug>.md`) — use when (a) plan mode was used, or (b) the work is multi-step, has design choices to commit to, or introduces follow-up tasks for future sessions.

**Rule of thumb:** if the design itself is the artifact, it's a plan. If you just need a journal of what happened, it's a log.

### Mirroring harness plans

When plan mode is used, copy the approved plan from `~/.claude/plans/<slug>.md` into `packages/docs/plans/` using the dated naming convention before beginning implementation.

### Conventions (both logs and plans)

- **Include a `## Status` line** near the top: `In Progress`, `Complete`, `Partially Complete`, or `Abandoned`.
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

When a plan in `packages/docs/plans/` reaches `Status: Complete` and the work is shipped, `git mv` it to `packages/docs/archive/completed/`. Don't leave finished plans accumulating in `plans/`.

## TODO Documentation

`packages/docs/todos/` is for **general issue tracking** — deferred work, acceptance-testing gaps, post-merge verifications, and any thread that needs to outlive a single session. It is not limited to source-code markers; most todos will have no marker at all.

- Every source marker (`TODO(todo:<kebab-id>)`, `FIXME(todo:<kebab-id>)`, `XXX(todo:<kebab-id>)`) MUST have a matching `packages/docs/todos/<kebab-id>.md`. This direction is enforced.
- General issue todos may exist with no source marker. Use kebab-case ids; the filename (sans `.md`) is the id.
- TODO docs use YAML frontmatter: `id`, `status` (one of `active`, `deferred`, `blocked`, `waiting-on-verification`, `resolved`), `origin` (path to the log/plan/PR that birthed it), and `source_marker: true` only if a code marker exists.
- When resolved, delete the doc and remove any matching source marker in the same commit.
- `bun scripts/check-todos.ts` enforces the source-marker → doc invariant (plus frontmatter/id sanity) in pre-commit and CI.

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

## Dagger & CI Code — Banned Patterns

These patterns are banned in `.dagger/src/` and `scripts/ci/src/`. Automated checks (`scripts/check-dagger-hygiene.ts`) enforce this in pre-commit and CI. Do not write them.

- `|| true` — never swallow errors silently
- `2>/dev/null` — never hide stderr
- `|| bun install` (after `--frozen-lockfile`) — never bypass lockfile enforcement
- `|| echo` — never convert errors to messages
- `x-access-token` in URLs — use `GIT_ASKPASS` for git authentication
- Writing tokens to files (`.npmrc`, etc.) — use `--token` flags or Dagger `Secret` type
- `git add -A` or `git add .` — always stage specific files by path
- `--no-exit-code` — never bypass quality gate exit codes

If a command legitimately needs error handling, handle the specific error explicitly (e.g., check existence before creating, parse exit codes) rather than blanket-suppressing all failures.

## Commands

```bash
# Root commands
bun run build|test|typecheck

# Package-specific
bun run --filter='./packages/<name>' <script>

# Linting (per-package)
cd packages/<name> && bunx eslint . --fix

# CI runs on Buildkite (NOT GitHub Actions)
# Check CI status via Buildkite CLI or web UI, never `gh run`

# CI pipeline generator
cd scripts/ci && bun run src/main.ts
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

## Development Setup

```bash
bun run scripts/setup.ts     # Trust mise configs, install tools/deps, build shared artifacts, run codegen
# Once the repo is trusted, `mise run dev` is equivalent.
```

Run `bun run scripts/setup.ts` after cloning or pulling changes that modify dependencies or schemas.

The setup script runs 5 phases:

1. **Tools** — `mise trust` for repo configs, `mise install`, and optional tool warnings
2. **Dependencies** — root + per-package `bun install --frozen-lockfile`
3. **Shared Builds** — eslint-config, webring, astro-opengraph-images, discord-video-stream, helm-types
4. **Code Generation** — Prisma (birmel, scout-for-lol, discord-plays-mario-kart). Helm value types are **not** regenerated here: the committed types in `packages/homelab/src/cdk8s/generated/helm` are the source of truth, refreshed weekly by the `helm-types-weekly-refresh` Temporal schedule (which opens a PR if they drifted).
5. **Verify** — checks critical build artifacts exist

Optional tools (warned if missing): helm, swift, swiftlint, swiftformat, typeshare, go, golangci-lint, mvn, gitleaks, shellcheck.

## Verification

Always verify changes:

1. `bun run typecheck` - Type errors
2. `bun run test` - Test failures
3. `bunx eslint . --fix` - Lint issues (in relevant package)

## Parallel Work — Use Worktrees

**Before your first edit on any non-trivial change, create a `git worktree` — don't edit in the main checkout.** "Non-trivial" = anything you'll open a PR for, anything touching more than one file, or any multi-step task. Only stay in the main checkout for a single-file, single-commit fix you won't PR (a typo, a one-line config tweak). **When unsure, make the worktree.** Each worktree gives a branch its own isolated working directory, so parallel work and concurrent agents never collide.

```bash
# Create an isolated worktree on a new branch off main
git worktree add .claude/worktrees/<feature-slug> -b feature/<slug> origin/main

cd .claude/worktrees/<feature-slug>

# REQUIRED before any build/test in the new worktree — runs codegen, shared builds, deps.
# Without this, builds fail with cryptic missing-module / missing-generated-file errors.
bun run scripts/setup.ts
```

After PR merge: `git worktree remove .claude/worktrees/<feature-slug>` and `git branch -d feature/<slug>` from the main checkout. Run `git worktree prune` to clean up stale entries.

See the `worktree-workflow` skill for the full workflow. `claude -w <slug>` creates and enters a worktree at launch; for Codex, create the worktree first and start it with `codex -C <dir>`. A `SessionStart` hook (`.claude/hooks/worktree-reminder.sh`, wired for both Claude Code and Codex) also reminds you whenever a session opens in the main checkout.

**If you were started in a worktree, stay in that worktree.** Keep every command, search, and file operation scoped to the worktree path you were launched in. Do not `cd` into, read from, or write to the main checkout (the parent of the `.claude/worktrees/` directory you are in) — the worktree is a complete checkout with the same files, so there is no reason to reach outside it. The main checkout may hold the user's own in-progress work; only touch it when the user explicitly asks.

**Never trust an absolute path from a subagent (Explore/Plan/general-purpose) report.** Subagents search the entire repo and report main-checkout paths like `/…/monorepo/packages/<x>/…` — NOT your worktree path. The two trees share an identical relative layout, so a `Write`/`Edit` to a main-checkout absolute path **silently succeeds in the wrong tree** (your `git status` stays clean and you won't notice until much later). Before writing, **rebase every path onto your worktree root**: take the `packages/…`-relative portion and prepend `.claude/worktrees/<name>/`. A reliable check: the absolute target path of any `Write`/`Edit` MUST contain `/.claude/worktrees/<name>/`. If it doesn't, you're about to write to main — stop and fix the path. Prefer worktree-relative paths over absolute ones for exactly this reason.

## Package Notes

Each package has its own AGENTS.md with specific instructions:

- `packages/birmel/AGENTS.md` - VoltAgent setup, Discord bot config
- `packages/homelab/AGENTS.md` - K8s, cdk8s, OpenTofu infrastructure
- `packages/scout-for-lol/AGENTS.md` - Match analysis pipeline
- `packages/resume/AGENTS.md` - Resume site
- `packages/toolkit/AGENTS.md` - CLI developer tools (fetch, recall, pr, pd, bugsink, grafana)
- `packages/tasks-for-obsidian/AGENTS.md` - React Native task app
- `packages/docs/` - AI-maintained docs (see `monorepo-docs` skill)

## Toolkit — Fetch & Recall

The `toolkit` CLI (`~/.local/bin/toolkit`) provides web fetching and local RAG search across all Claude history.

### Searching past work

Use `toolkit recall search` to find context from previous conversations, plans, research, docs, and fetched pages **before** answering knowledge questions or starting tasks that may have been discussed before.

```bash
# Search across everything (hybrid semantic + keyword)
toolkit recall search "how does the CI pipeline work"
toolkit recall search "kubernetes resource limits"
toolkit recall search "interview prep system design"
```

This searches:

- All past Claude conversations (`.jsonl` files)
- Claude plans and research (`~/.claude/plans/`, `~/.claude-extra/research/`)
- Claude memories (`~/.claude/projects/*/memory/`)
- Monorepo docs (`packages/docs/`)
- Fetched web pages (`~/.recall/fetched/`)

### Fetching web pages

```bash
toolkit fetch <url>              # Fetch via lightpanda, save + index
toolkit fetch <url> --browser    # Use PinchTab CLI (real Chrome) if lightpanda is blocked
toolkit fetch <url> --crawl      # Crawl a docs site
```

**Use `toolkit fetch` instead of raw `lightpanda fetch`** — it saves the output and auto-indexes it for future search.

### Index management

```bash
toolkit recall add <path>        # Index a file or directory
toolkit recall reindex           # Re-scan all watched directories
toolkit recall status            # Index stats, daemon health
toolkit recall debug             # Full diagnostic check
```

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
