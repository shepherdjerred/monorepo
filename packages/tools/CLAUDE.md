# tools

CLI utilities for development workflows, optimized for Claude Code consumption.

## Commands

```bash
# Development
bun run src/index.ts pr health      # Run directly with bun
bun run src/index.ts pr logs 123
bun run src/index.ts pr detect

# Build
bun run build                       # Compile to dist/tools

# Type checking
bun run typecheck

# Install globally
./install.sh                        # Installs to ~/.local/bin
```

## Structure

```
src/
├── index.ts              # CLI entry point
├── commands/pr/          # PR subcommands
│   ├── health.ts         # PR health check
│   ├── logs.ts           # Workflow logs
│   └── detect.ts         # PR detection
└── lib/
    ├── github/           # GitHub API via gh CLI
    ├── git/              # Git operations
    └── output/           # Output formatting
```

## Adding New Commands

1. Create command file in `src/commands/<category>/`
2. Export from category's `index.ts`
3. Add routing in `src/index.ts`
4. Update skill in `skills/pr-health/SKILL.md`

## Design Principles

- Use `gh` CLI for GitHub operations (no API tokens needed)
- Use Bun shell (`$`) for subprocess execution
- Output markdown optimized for Claude Code
- Include actionable commands in error output
- Exit non-zero on unhealthy status
