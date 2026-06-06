# AGENTS.md

Bun workspaces monorepo. Use `bun` commands exclusively (never npm/yarn/pnpm).

## Structure

```
packages/
├── anki/                    # Anki flashcard tools
├── astro-opengraph-images/  # Astro OpenGraph image generation
├── better-skill-capped/     # Browser extension
├── birmel/                  # Discord bot (VoltAgent + Claude AI)
├── bun-decompile/           # Bun binary decompiler
├── discord-plays-pokemon/   # Discord Plays Pokemon
├── docs/                    # AI-maintained monorepo documentation
├── dotfiles/                # Dotfiles & shell config
├── eslint-config/           # Shared ESLint rules
├── fonts/                   # Custom fonts
├── homelab/                 # Homelab infrastructure (K8s, Tofu)
├── resume/                  # Resume site
├── scout-for-lol/           # League of Legends match analysis
├── sjer.red/                # Personal website
├── starlight-karma-bot/     # Discord karma bot
├── toolkit/                 # CLI developer tools (fetch, recall, pr, pd, bugsink, grafana)
├── webring/                 # Webring component
scripts/ci/                  # TypeScript CI pipeline generator
archive/                     # Legacy projects (do not modify), including castle-casters, clauderon, glance, hn-enhancer, macos-cross-compiler, tips
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

## Development Setup

```bash
bun run scripts/setup.ts     # Trust mise configs, install tools/deps, build shared artifacts, run codegen
# Once the repo is trusted, `mise run dev` is equivalent.
```

Run `bun run scripts/setup.ts` after cloning or pulling changes that modify dependencies or schemas.

The setup script runs 5 phases:

1. **Tools** — `mise trust` for repo configs, `mise install`, and optional tool warnings
2. **Dependencies** — root + per-package `bun install --frozen-lockfile`
3. **Shared Builds** — eslint-config, webring, astro-opengraph-images, helm-types
4. **Code Generation** — Prisma (birmel, scout-for-lol), helm-types codegen, HA types
5. **Verify** — checks critical build artifacts exist

Optional tools (warned if missing): helm, swift, swiftlint, swiftformat, typeshare, go, golangci-lint, mvn, gitleaks, shellcheck.

## Verification

Always verify changes:

1. `bun run typecheck` - Type errors
2. `bun run test` - Test failures
3. `bunx eslint . --fix` - Lint issues (in relevant package)

## Parallel Work — Use Worktrees

When starting parallel feature work, hot-fixing while another change is in progress, or running multiple Claude agents in this repo concurrently, use `git worktree` to get an isolated working directory per branch.

```bash
# Create an isolated worktree on a new branch off main
git worktree add .claude/worktrees/<feature-slug> -b feature/<slug> origin/main

cd .claude/worktrees/<feature-slug>

# REQUIRED before any build/test in the new worktree — runs codegen, shared builds, deps.
# Without this, builds fail with cryptic missing-module / missing-generated-file errors.
bun run scripts/setup.ts
```

After PR merge: `git worktree remove .claude/worktrees/<feature-slug>` and `git branch -d feature/<slug>` from the main checkout. Run `git worktree prune` to clean up stale entries.

See the `worktree-workflow` skill for the full workflow. Trivial single-file edits don't need a worktree — those stay in the main checkout.

**If you were started in a worktree, stay in that worktree.** Keep every command, search, and file operation scoped to the worktree path you were launched in. Do not `cd` into, read from, or write to the main checkout (the parent of the `.claude/worktrees/` directory you are in) — the worktree is a complete checkout with the same files, so there is no reason to reach outside it. The main checkout may hold the user's own in-progress work; only touch it when the user explicitly asks.

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
