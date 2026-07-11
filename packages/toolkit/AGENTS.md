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

| Variable             | Description                                                      |
| -------------------- | ---------------------------------------------------------------- |
| `PAGERDUTY_TOKEN`    | PagerDuty API token                                              |
| `BUGSINK_URL`        | Bugsink instance URL (e.g., `https://bugsink.example.com`)       |
| `BUGSINK_TOKEN`      | Bugsink API token                                                |
| `GRAFANA_URL`        | Grafana instance URL                                             |
| `GRAFANA_API_KEY`    | Grafana API key or service account token                         |
| `AWS_PROFILE`        | AWS profile for `pr asset` (or pass `--profile`)                 |
| `DISCORD_BOT_TOKEN`  | Discord bot token for `discord daemon start` (optional)          |
| `DISCORD_USER_TOKEN` | Discord user/selfbot token for `discord daemon start` (optional) |

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
  (`test-integration/catalog.integration.test.ts`, run via `bun run test:integration`
  in a git checkout) asserts every versionKey exists in the live
  `versions.ts`.

## `discord` — act on Discord through a session daemon

`toolkit discord` lets agents send/read messages, invoke other bots' slash
commands, and join voice channels, for testing/iterating on Discord bots. It
avoids the per-script `op` approval + gateway-login cost of one-off scripts by
running a **session daemon** that logs in once and holds the gateway connections
in memory; one-shot CLI commands talk to it over a unix socket.

```bash
# start once per session (tokens in env, one op call):
export DISCORD_USER_TOKEN=$(op read "op://Personal/<item-id>/TOKEN")
toolkit discord daemon start --ttl 30m      # also reads DISCORD_BOT_TOKEN if set
toolkit discord send <channelId> "hello"
toolkit discord slash <channelId> <botId> <command> [args...]   # userbot only
toolkit discord voice join <channelId>      # presence persists between commands
toolkit discord voice states <guildId>      # streaming flags (needs a bot token)
toolkit discord daemon stop
```

Design notes encoded in the code:

- **At least one of `DISCORD_BOT_TOKEN` / `DISCORD_USER_TOKEN`** must be set; each
  client is optional and commands route to the identity they need (slash + voice
  join are userbot-only; voice states is bot-only).
- Tokens are passed to the detached daemon via **env, never argv** (not visible in
  `ps`) and never written to the state file or logs.
- State dir `~/.toolkit/discord/`: `daemon.sock` (0600), `state.json` (pid +
  identities, no secrets), `logs/`. The daemon auto-exits after an idle TTL so a
  selfbot is never left connected indefinitely.
- Voice join is a **gateway VoiceStateUpdate (op 4)**, not the selfbot's
  `joinChannel()` (which times out on deprecated voice encryption).
- Use `pathExists()` (stat-based), not `Bun.file().exists()`, to test the socket —
  the latter returns false for a unix socket.
- Libs (`discord.js`, `discord.js-selfbot-v13`) bundle into the compiled binary
  with `--external ffmpeg-static` (an optional native dep of a voice transitive).

The agent-facing how-to lives in the `discord` skill.

## `pr asset` — PR media host

`toolkit pr asset <PR> <file|dir...> [--markdown] [--profile <name>]` uploads
PR media (screenshots, GIFs, videos, asciinema recordings, static demo-site
directories) to the `public-sjer-red` SeaweedFS bucket under `pr/assets/<PR>/`
and prints one public `https://public.sjer.red/...` URL per argument for
embedding in PRs. Uses `@aws-sdk/client-s3` with `forcePathStyle: true`
(path-style is required for SeaweedFS).

Behavior by input type:

- **Directories** are auto-detected (no flag), must contain a root
  `index.html` (fail-fast otherwise), and upload recursively to
  `pr/assets/<PR>/<dirname>/<relative path>`; dotfiles/dot-dirs and symlinks
  inside are skipped. The printed URL points at `index.html`, so no
  server-side SPA fallback is involved.
- **`.cast` recordings** (asciinema) also upload a generated self-contained
  HTML player page at `<name>.cast.html` — the `asciinema-player` npm
  package's JS/CSS are vendored via Bun text imports and inlined, so the page
  has no CDN or node_modules dependency at runtime. The printed URL is the
  player page, never the raw cast.
- **`--markdown`** emits per content-type class (`markdownForAsset` in
  `src/lib/s3/assets.ts`): images `![name](url)` (render inline via GitHub's
  proxy), video `[name (video)](url)` (GitHub never embeds external video),
  HTML `[name (demo)](url)`, PDF `[name (pdf)](url)`, casts
  `[name (terminal recording)](player url)`, everything else `[name](url)`.

All planning/validation (paths exist, demo dirs have an entry point, no two
uploads — including generated player pages — target the same object key)
completes before the first upload, so a bad argument never leaves a partial
object set behind.

Credentials, endpoint (`endpoint_url`), and region are resolved by the standard
AWS toolchain — `~/.aws/credentials`, `~/.aws/config`, and `AWS_*` env vars,
exactly like the AWS CLI. Select a profile with `--profile <name>` or
`AWS_PROFILE`; no `op run` wrapper is needed:

```bash
toolkit pr asset 1234 ./after.png ./flow.mp4 ./demo.cast ./demo-site --profile seaweedfs --markdown
```

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
