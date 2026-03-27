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
scripts/ci/                  # Python CI scripts (uv + Python)
archive/                     # Legacy projects (do not modify)
```

## Commands

```bash
# Root commands
bun run build|test|typecheck

# Package-specific
bun run --filter='./packages/<name>' <script>

# Linting (per-package)
cd packages/<name> && bunx eslint . --fix

# Bazel build & test
bazel build //...
bazel test //...

# CI runs on Buildkite (NOT GitHub Actions)
# Check CI status via Buildkite CLI or web UI, never `gh run`

# Python CI scripts (release, deploy, etc.)
cd scripts/ci && uv run python -m ci.<module>
```

## Development Setup

```bash
mise trust && mise dev   # Installs bun + bazel
```

## Verification

Always verify changes:

1. `bun run typecheck` - Type errors
2. `bun run test` - Test failures
3. `bunx eslint . --fix` - Lint issues (in relevant package)

## Bazel Debugging

- Never pipe build/test commands through `grep`, `tail`, or `head` inline. Run the command raw, get the full output, then reason about it. A missed grep pattern means re-running the entire build (30-60s wasted).
- When a test fails, Bazel prints `see /path/to/test.log`. **Read that file with the Read tool.** Do not grep or tail the bazel stderr output.
- When a build action fails, use `--sandbox_debug` to retain the sandbox, then inspect it.
- When debugging `run_shell` actions, add `set -x` to the script to trace execution.
- Never use `bazel clean`, `--expunge`, `shutdown`, or `--force fetch` as debugging steps. If Bazel seems stale, the bug is in your code.
- Never run build tools (`bun install`, `prisma generate`, `tsc`, etc.) outside Bazel.
- Never tag targets `manual` to hide failures. Fix the root cause.
- Stop after 2 failed iterations of debugging a shell script in a Bazel action. Step back and reconsider the approach.

## Bazel Conventions

- Use `@types/bun`, never `bun-types` in BUILD.bazel deps
- `bun_library` globs must exclude `*.test.ts` and `*.spec.ts`
- Manual tags require a `# Manual: <reason>` comment on the preceding line
- Never use `readlink -f` (not portable on macOS) — use POSIX `_realpath` or `$BUN_BINARY`
- Never use `python3` in runner scripts — use `$BUN_BINARY -e` instead
- Never add `/usr/local/bin` to PATH in `.bzl` files
- New workspace packages must add their `package.json` to `npm_translate_lock` data list in `MODULE.bazel`
- Version constants (Bun, Prisma) have a single source of truth in `versions.bzl` files
- Scoped packages (e.g. `@shepherdjerred/eslint-config`) must set `package_name` on `bun_library`
- During development, use targeted builds (`bazel test //packages/foo:lint`) — never `bazel test //...`

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
- Claude plans and research (`~/.claude/plans/`, `~/.claude/research/`)
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
