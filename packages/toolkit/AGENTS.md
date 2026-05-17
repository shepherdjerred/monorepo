# toolkit

CLI utilities for development workflows, optimized for Claude Code consumption.

## Commands

```bash
# Development
bun run src/index.ts fetch <url>           # Fetch a web page
bun run src/index.ts recall search <query> # Search indexed documents
bun run src/index.ts pr health             # PR health check

bun run src/index.ts pd incidents          # PagerDuty incidents
bun run src/index.ts bugsink issues        # Bugsink issues
bun run src/index.ts gf dashboards         # Grafana dashboards

# Build
bun run build                              # Compile to dist/toolkit

# Type checking & tests
bun run typecheck
bun test

# Install globally
./install.sh                               # Installs to ~/.local/bin/toolkit
```

## Structure

```
src/
├── index.ts              # CLI entry point
├── handlers/             # Command routers
│   ├── fetch.ts          # toolkit fetch
│   ├── recall.ts         # toolkit recall
│   ├── pr.ts             # toolkit pr
│   ├── pagerduty.ts      # toolkit pd
│   ├── bugsink.ts        # toolkit bugsink
│   └── grafana.ts        # toolkit gf
├── commands/
│   ├── fetch/            # Fetch subcommands
│   ├── recall/           # Recall subcommands
│   ├── pr/               # PR subcommands
│   ├── pagerduty/        # PagerDuty subcommands
│   ├── bugsink/          # Bugsink subcommands
│   └── grafana/          # Grafana subcommands
└── lib/
    ├── fetch/            # Lightpanda + PinchTab wrappers, save logic
    ├── recall/           # LanceDB + SQLite FTS5, MLX embeddings, chunker, search
    ├── github/           # GitHub API via gh CLI
    ├── pagerduty/        # PagerDuty REST API client
    ├── bugsink/          # Bugsink REST API client
    ├── grafana/          # Grafana REST API client
    └── output/           # Output formatting
```

## Environment Variables

| Variable          | Description                                                |
| ----------------- | ---------------------------------------------------------- |
| `PAGERDUTY_TOKEN` | PagerDuty API token                                        |
| `BUGSINK_URL`     | Bugsink instance URL (e.g., `https://bugsink.example.com`) |
| `BUGSINK_TOKEN`   | Bugsink API token                                          |
| `GRAFANA_URL`     | Grafana instance URL                                       |
| `GRAFANA_API_KEY` | Grafana API key or service account token                   |

## Adding New Commands

1. Create command file in `src/commands/<category>/`
2. Create handler in `src/handlers/<category>.ts`
3. Add routing in `src/index.ts`
4. Update relevant skill in `skills/`

## Design Principles

- Use `gh` CLI for GitHub operations (no API tokens needed)
- Use Bun shell (`$`) for subprocess execution
- Output markdown optimized for Claude Code
- Include actionable commands in error output
- Exit non-zero on unhealthy status
