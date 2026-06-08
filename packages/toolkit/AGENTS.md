# toolkit

CLI utilities for development workflows, optimized for Claude Code consumption.

## Commands

```bash
# Development
bun run src/index.ts fetch <url>           # Fetch a web page
bun run src/index.ts recall search <query> # Search indexed documents
bun run src/index.ts pr health             # PR health check
bun run src/index.ts deployed scout        # Is a service/commit live on the homelab?

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
│   ├── deployed.ts       # toolkit deployed
│   ├── pagerduty.ts      # toolkit pd
│   ├── bugsink.ts        # toolkit bugsink
│   └── grafana.ts        # toolkit gf
├── commands/
│   ├── fetch/            # Fetch subcommands
│   ├── recall/           # Recall subcommands
│   ├── pr/               # PR subcommands
│   ├── deployed/         # `deployed` orchestration
│   ├── pagerduty/        # PagerDuty subcommands
│   ├── bugsink/          # Bugsink subcommands
│   └── grafana/          # Grafana subcommands
└── lib/
    ├── fetch/            # Lightpanda + PinchTab wrappers, save logic
    ├── recall/           # LanceDB + SQLite FTS5, MLX embeddings, chunker, search
    ├── github/           # GitHub API via gh CLI
    ├── deployed/         # Commit → homelab deploy trace (git/argocd/kubectl)
    ├── pagerduty/        # PagerDuty REST API client
    ├── bugsink/          # Bugsink REST API client
    ├── grafana/          # Grafana REST API client
    └── output/           # Output formatting
```

## Environment Variables

| Variable                      | Description                                                 |
| ----------------------------- | ----------------------------------------------------------- |
| `PAGERDUTY_TOKEN`             | PagerDuty API token                                         |
| `BUGSINK_URL`                 | Bugsink instance URL (e.g., `https://bugsink.example.com`)  |
| `BUGSINK_TOKEN`               | Bugsink API token                                           |
| `GRAFANA_URL`                 | Grafana instance URL                                        |
| `GRAFANA_API_KEY`             | Grafana API key or service account token                    |
| `SEAWEEDFS_ACCESS_KEY_ID`     | SeaweedFS S3 access key (`pr asset`)                        |
| `SEAWEEDFS_SECRET_ACCESS_KEY` | SeaweedFS S3 secret key (`pr asset`)                        |
| `SEAWEEDFS_S3_ENDPOINT`       | S3 endpoint override (default `https://seaweedfs.sjer.red`) |
| `SEAWEEDFS_S3_REGION`         | S3 region override (default `us-east-1`)                    |

## `deployed` — is my commit/service live on the homelab?

`toolkit deployed [<selector>] [--commit <ref>] [--json] [--no-cluster] [--no-github]`
automates the manual trace in
`packages/docs/guides/2026-04-06_is-commit-deployed.md`: it follows a commit
through the **two-build** pipeline (feature merge → version-commit-back bump →
the bump's own build does cdk8s synth + helm push + ArgoCD sync) and reports,
per affected service/variant, whether it's actually running.

Selectors: `scout` (service, all variants), `scout/prod` (one product),
`birmel --commit <sha>`, or a bare `<commit>`/none (HEAD → auto-detect affected
services). Verdict ladder: `NOT_MERGED → PENDING → NO_IMAGE → PINNED → SYNCED →
RUNNING`.

Layers auto-degrade: the git trace always runs; `gh` adds PR/merge context;
`argocd` and `kubectl` confirm the live pod digest. Implementation notes that bit
us and are encoded in the code:

- Use **ancestry** (`git merge-base --is-ancestor`), never linear `git log`
  order — bumps are cut on side branches.
- Find the bump that **wrote a digest** via `git log -S<digest>` (a promoted prod
  tag like `2.0.0-2985` can be written by a later build `2.0.0-3016`).
- `argocd app get` needs `--grpc-web`; its synced "revision" is the Helm chart
  version `2.0.0-<build>`, not a git SHA.
- The pod digest lives in `imageID` (often `<repo>@sha256:…`), not `image`.
- The service registry lives in `src/lib/deployed/catalog.ts`; a drift test
  (`test/deployed/catalog.test.ts`) asserts every versionKey exists in the live
  `versions.ts`.

## `pr asset` — PR screenshot host

`toolkit pr asset <PR> <file...> [--markdown]` uploads files to the
`public-sjer-red` SeaweedFS bucket under `pr/assets/<PR>/` and prints the public
`https://public.sjer.red/...` URLs for embedding in PRs. Uses a minimal SigV4
PUT (`src/lib/s3/`), no AWS SDK. Supply creds via 1Password, e.g.
`op run --env-file=... -- toolkit pr asset 1234 ./after.png --markdown`.

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
