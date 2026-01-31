# tools

CLI utilities for development workflows, optimized for Claude Code consumption.

## Commands

```bash
# Development
bun run src/index.ts pr health      # Run directly with bun
bun run src/index.ts pr logs 123
bun run src/index.ts pr detect

bun run src/index.ts pd incidents   # PagerDuty incidents
bun run src/index.ts pd incident P1234567

bun run src/index.ts bugsink issues # Bugsink issues
bun run src/index.ts bugsink issue 123

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
├── commands/
│   ├── pr/               # PR subcommands
│   │   ├── health.ts     # PR health check
│   │   ├── logs.ts       # Workflow logs
│   │   └── detect.ts     # PR detection
│   ├── pagerduty/        # PagerDuty subcommands
│   │   ├── incidents.ts  # List incidents
│   │   └── incident.ts   # Incident details
│   └── bugsink/          # Bugsink subcommands
│       ├── issues.ts     # List issues
│       └── issue.ts      # Issue details
└── lib/
    ├── github/           # GitHub API via gh CLI
    ├── git/              # Git operations
    ├── pagerduty/        # PagerDuty REST API client
    ├── bugsink/          # Bugsink REST API client
    └── output/           # Output formatting
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PAGERDUTY_API_KEY` | PagerDuty API token |
| `BUGSINK_URL` | Bugsink instance URL (e.g., `https://bugsink.example.com`) |
| `BUGSINK_TOKEN` | Bugsink API token |

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
