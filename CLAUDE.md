# CLAUDE.md

Bun workspaces monorepo. Use `bun` commands exclusively (never npm/yarn/pnpm).

## Structure

```
packages/
├── anki/                    # Anki flashcard tools
├── astro-opengraph-images/  # Astro OpenGraph image generation
├── better-skill-capped/     # Browser extension
├── birmel/                  # Discord bot (VoltAgent + Claude AI)
├── bun-decompile/           # Bun binary decompiler
├── castle-casters/          # Game project
├── clauderon/               # Rust session manager (has its own CLAUDE.md)
├── discord-plays-pokemon/   # Discord Plays Pokemon
├── docs/                    # AI-maintained monorepo documentation
├── dotfiles/                # Dotfiles & shell config
├── eslint-config/           # Shared ESLint rules
├── fonts/                   # Custom fonts
├── homelab/                 # Homelab infrastructure (K8s, Tofu)
├── macos-cross-compiler/    # macOS cross-compilation
├── resume/                  # Resume site
├── scout-for-lol/           # League of Legends match analysis
├── sjer.red/                # Personal website
├── starlight-karma-bot/     # Discord karma bot
├── toolkit/                 # CLI developer tools (fetch, recall, pr, pd, bugsink, grafana)
├── webring/                 # Webring component
scripts/ci/                  # TypeScript CI pipeline generator
archive/                     # Legacy projects (do not modify)
```

## Documentation Discipline — Per Session

**Every session must produce or update a plan file in-repo, and end with a written summary appended to that plan file.** This applies even to one-shot edits — the plan file may be brief, but it must exist.

### Plan files (in-repo)

- **Location:** `packages/docs/plans/<YYYY-MM-DD>_<kebab-case-slug>.md`
- **Mirror harness plans.** When plan mode is used, copy the approved plan from `~/.claude/plans/<slug>.md` into `packages/docs/plans/` using the dated naming convention before beginning implementation.
- **Create a plan even without plan mode.** For non-plan-mode sessions, write a brief plan file capturing intent, scope, files to touch, and verification steps before edits begin.
- **Include a `## Status` line** near the top: `In Progress`, `Complete`, `Partially Complete`, or `Abandoned`.
- **Raw Markdown only** — never render to PDF or Typst.
- **Update `packages/docs/index.md`** when adding a new plan file.
- See `packages/docs/CLAUDE.md` for the broader docs taxonomy (architecture / patterns / decisions / guides / plans).

### End-of-session summary

Before ending any session, append a section to the plan file:

```markdown
## Session Log — <YYYY-MM-DD>

### Done

- <bullets of work actually completed: file paths, PR/commit refs>

### Remaining

- <work the user asked for that wasn't finished, with concrete next steps>

### Caveats

- <known issues, deferred decisions, surprises, warnings the next agent needs>
```

If a session spans multiple plan files, append a Session Log to each. **Also restate the same Done / Remaining / Caveats inline as the final chat message** so the user sees it without opening the file.

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
mise trust && mise install   # Install bun, rust, java
bun run scripts/setup.ts     # Full setup: deps, shared builds, codegen
# Or equivalently: mise run dev
```

Run `bun run scripts/setup.ts` after cloning or pulling changes that modify dependencies or schemas.

The setup script runs 5 phases:

1. **Tools** — `mise install` + warns about optional tools
2. **Dependencies** — root + per-package `bun install --frozen-lockfile`
3. **Shared Builds** — eslint-config, webring, astro-opengraph-images, helm-types, clauderon/web shared+client
4. **Code Generation** — Prisma (birmel, scout-for-lol), helm-types codegen, HA types
5. **Verify** — checks critical build artifacts exist

Optional tools (warned if missing): helm, swift, swiftlint, swiftformat, typeshare, go, golangci-lint, mvn, gitleaks, shellcheck.

## Verification

Always verify changes:

1. `bun run typecheck` - Type errors
2. `bun run test` - Test failures
3. `bunx eslint . --fix` - Lint issues (in relevant package)

## Parallel Work — Prefer Dissociated Clones

When starting parallel feature work, hot-fixing while another change is in progress, or running multiple Claude agents in this repo concurrently, **prefer dissociated clones over `git worktree`**. Worktrees share `refs/stash` and the reflog across checkouts, which causes collisions during merges and multi-agent work. Dissociated clones give each checkout its own stash, reflog, and gc — at the cost of a per-clone setup run.

```bash
# Create an isolated working clone (own stash, own reflog, no network needed)
git clone --shared --dissociate \
  /Users/jerred/git/monorepo \
  ~/git/monorepo-<feature-slug>

cd ~/git/monorepo-<feature-slug>

# Re-point origin from the local source path to the real remote.
# Without this, `git push` would push to the local source, not GitHub.
git remote set-url origin <remote-url>
git fetch origin --prune

# Branch from the real origin/main
git switch -c feature/<slug> origin/main

# REQUIRED before any build/test in the new clone — runs codegen, shared builds, deps.
# Without this, builds fail with cryptic missing-module / missing-generated-file errors.
bun run scripts/setup.ts
```

After PR merge: `rm -rf ~/git/monorepo-<feature-slug>` and `git branch -d feature/<slug>` in the main checkout. See the `dissociated-clone-workflow` skill for the full workflow, including helper scripts.

**Cost trade-off**: each clone is ~600 MB for `.git` plus ~20 GB after `bun run scripts/setup.ts`. Worth it for isolated parallel work or multi-agent runs; not worth it for trivial single-file edits — those stay in the main checkout.

## Package Notes

Each package has its own CLAUDE.md with specific instructions:

- `packages/clauderon/CLAUDE.md` - Rust build order, backends, architecture
- `packages/birmel/CLAUDE.md` - VoltAgent setup, Discord bot config
- `packages/homelab/CLAUDE.md` - K8s, cdk8s, OpenTofu infrastructure
- `packages/scout-for-lol/CLAUDE.md` - Match analysis pipeline
- `packages/resume/CLAUDE.md` - Resume site
- `packages/toolkit/CLAUDE.md` - CLI developer tools (fetch, recall, pr, pd, bugsink, grafana)
- `packages/tasks-for-obsidian/CLAUDE.md` - React Native task app
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
