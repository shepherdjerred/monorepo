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
mise trust && mise dev   # Installs bun + rust
```

## Verification

Always verify changes:

1. `bun run typecheck` - Type errors
2. `bun run test` - Test failures
3. `bunx eslint . --fix` - Lint issues (in relevant package)

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
