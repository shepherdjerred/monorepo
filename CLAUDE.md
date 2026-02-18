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
├── dotfiles/                # Dotfiles & shell config
├── eslint-config/           # Shared ESLint rules
├── fonts/                   # Custom fonts
├── homelab/                 # Homelab infrastructure (K8s, Tofu)
├── macos-cross-compiler/    # macOS cross-compilation
├── resume/                  # Resume site
├── scout-for-lol/           # League of Legends match analysis
├── sjer.red/                # Personal website
├── starlight-karma-bot/     # Discord karma bot
├── tools/                   # CLI developer tools
├── webring/                 # Webring component
.dagger/                     # CI/CD pipeline
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

# CI (Dagger)
dagger call ci
```

## Development Setup

```bash
mise trust && mise dev   # Installs bun + dagger
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
- `packages/tools/CLAUDE.md` - CLI developer tools
