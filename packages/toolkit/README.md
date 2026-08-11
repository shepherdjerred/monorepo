# toolkit

Command-line utilities for development workflows against this monorepo and the
homelab: PR health and media hosting, deploy tracing, frontend screenshots,
alert/error/metrics queries, and a Discord session daemon. Output is markdown
optimized for agent (Claude Code) consumption; commands exit non-zero on
unhealthy status.

See [AGENTS.md](AGENTS.md) for contributor/agent workflow notes, including the
detailed design docs for `deployed`, `screenshot`, `discord`, and `pr asset`.

## Install and run

```bash
# Run from source (development)
bun run src/index.ts pr health

# Compile a standalone binary to dist/toolkit
bun run build

# Install globally to ~/.local/bin/toolkit
bun run install:local
```

After the global install, invoke everything as `toolkit <command> …`.

## Commands

Global options are only `--version` and `--help`/`-h`, and they must come
before the command — the top-level router treats any other leading flag as a
command name and exits 1. `--json` is a per-command option parsed by each
handler, so it goes _after_ the command (e.g. `toolkit alerts list --json`).
Run `toolkit --help` for the built-in reference.

### `pr` — pull request tooling

| Command                        | Description                                                              |
| ------------------------------ | ------------------------------------------------------------------------ |
| `pr health [PR_NUMBER]`        | Check PR health: conflicts, CI, approval                                 |
| `pr logs <RUN_ID>`             | Get workflow run logs                                                    |
| `pr detect`                    | Detect the PR for the current branch                                     |
| `pr asset <PR> <FILE\|DIR...>` | Upload PR media (images, video, `.cast`, demo dirs) to `public.sjer.red` |

`pr asset` uploads to the `public-sjer-red` SeaweedFS bucket under
`pr/assets/<PR>/` and prints one public URL per argument. Directories must
contain a root `index.html`; asciinema `.cast` files get a generated
self-contained HTML player page; `--markdown` emits ready-to-paste embed
markdown per content type. Credentials come from the standard AWS toolchain
(`--profile <name>` or `AWS_PROFILE`).

```bash
toolkit pr asset 1234 ./after.png ./flow.mp4 ./demo.cast ./demo-site --profile seaweedfs --markdown
```

### `deployed` — is my commit/service live on the homelab?

| Command                        | Description                                                  |
| ------------------------------ | ------------------------------------------------------------ |
| `deployed [SELECTOR]`          | Trace HEAD (or `--commit <ref>`) through the deploy pipeline |
| `deployed <service>`           | e.g. `scout`, `birmel` — is its latest commit live?          |
| `deployed <service>/<variant>` | e.g. `scout/prod` — scope to one product variant             |
| `deployed <commit> --json`     | Trace a specific commit, JSON output                         |

Follows a commit through the two-build pipeline (feature merge → version bump →
cdk8s synth + Helm push + ArgoCD sync) and reports a verdict per
service/variant: `NOT_MERGED → PENDING → NO_IMAGE → PINNED → SYNCED → RUNNING`.
Layers auto-degrade: the git trace always runs; `gh`, `argocd`, and `kubectl`
add PR context and live pod confirmation when available (`--no-github`,
`--no-cluster` to skip).

```bash
toolkit deployed scout/prod
```

### `screenshot` — visually verify a frontend change

| Command                    | Description                                                |
| -------------------------- | ---------------------------------------------------------- |
| `screenshot <pkg> [route]` | Boot a registered package's dev server, screenshot a route |
| `screenshot --list`        | List screenshot-able packages                              |

Spawns the package's dev server on its registered port and drives a
PinchTab-controlled Chrome tab to capture the route. Requires a running
PinchTab browser instance. The package registry lives in
`src/lib/screenshot/catalog.ts`.

```bash
toolkit screenshot stocks-sjer-red /
```

### `alerts` — homelab alert ledger

| Command            | Description                           |
| ------------------ | ------------------------------------- |
| `alerts list`      | List alert occurrences and history    |
| `alerts show <ID>` | View an alert occurrence and timeline |

### `bugsink` — self-hosted error tracking

| Command                                   | Description                                   |
| ----------------------------------------- | --------------------------------------------- |
| `bugsink issues`                          | List unresolved issues                        |
| `bugsink issue <ID>`                      | View issue details                            |
| `bugsink teams` / `team <UUID>`           | List teams / view team details                |
| `bugsink projects` / `project <ID>`       | List projects / view project details          |
| `bugsink events <ISSUE>` / `event <UUID>` | List events for an issue / view event details |
| `bugsink stacktrace <EVT>`                | Get an event stacktrace (markdown)            |
| `bugsink releases` / `release <UUID>`     | List releases / view release details          |

```bash
BUGSINK_URL=https://bugsink.example.com BUGSINK_TOKEN=… toolkit bugsink issues
```

### `grafana` (alias `gf`) — dashboards, Prometheus, Loki, alerting

| Command                                          | Description                                |
| ------------------------------------------------ | ------------------------------------------ |
| `grafana dashboards` / `dashboard <UID>`         | Search dashboards / view dashboard details |
| `grafana datasources` / `datasource <UID>`       | List datasources / view datasource details |
| `grafana query <EXPR>`                           | Run a PromQL query                         |
| `grafana metrics`                                | List Prometheus metric names               |
| `grafana labels` / `label-values <NAME>`         | Prometheus label names / values            |
| `grafana logs <EXPR>`                            | Run a LogQL query                          |
| `grafana log-labels` / `log-label-values <NAME>` | Loki label names / values                  |
| `grafana alerts` / `alert <UID>`                 | List alert rules / view rule details       |
| `grafana annotations` / `annotate <TEXT>`        | List / create annotations                  |

```bash
toolkit gf query 'up{job="birmel"}'
```

### `discord` — act on Discord through a session daemon

A daemon logs in once (bot and/or userbot identity) and holds the gateway
connection; one-shot commands talk to it over a unix socket in
`~/.toolkit/discord/`. At least one of `DISCORD_BOT_TOKEN` /
`DISCORD_USER_TOKEN` must be set when starting the daemon.

| Command                                    | Description                                  |
| ------------------------------------------ | -------------------------------------------- |
| `discord daemon start [--ttl 30m]`         | Start the session daemon (tokens via env)    |
| `discord daemon stop` / `daemon status`    | Manage the daemon                            |
| `discord send <CH> <MSG>`                  | Send a message                               |
| `discord read <CH> [-n 20]`                | Read recent messages (including embeds)      |
| `discord wait <CH>`                        | Block until a matching message arrives       |
| `discord slash <CH> <BOT> <CMD> [ARGS...]` | Invoke another bot's slash command (userbot) |
| `discord voice join\|leave\|states`        | Voice presence + who's streaming             |
| `discord guilds` / `discord channels`      | Discovery                                    |
| `discord whoami`                           | Daemon identities + uptime                   |

```bash
toolkit discord daemon start --ttl 30m
toolkit discord send 123456789012345678 "hello"
```

## Environment variables

| Variable              | Description                                                      |
| --------------------- | ---------------------------------------------------------------- |
| `ALERT_DASHBOARD_URL` | Alerts service URL (defaults to the tailnet service)             |
| `BUGSINK_URL`         | Bugsink instance URL                                             |
| `BUGSINK_TOKEN`       | Bugsink API token                                                |
| `GRAFANA_URL`         | Grafana instance URL                                             |
| `GRAFANA_API_KEY`     | Grafana API key or service account token                         |
| `AWS_PROFILE`         | AWS profile for `pr asset` (or pass `--profile`)                 |
| `DISCORD_BOT_TOKEN`   | Discord bot token for `discord daemon start` (optional)          |
| `DISCORD_USER_TOKEN`  | Discord user/selfbot token for `discord daemon start` (optional) |

## Development

```bash
bun run typecheck          # TypeScript
bun run lint               # ESLint
bun run test               # Unit tests (test/, scripts/)
bun run test:integration   # Catalog drift tests (requires a git checkout)
```

Architecture: `src/index.ts` routes to per-group handlers in `src/handlers/`,
which call command implementations in `src/commands/<group>/`. Service clients
live in `src/lib/` — the Grafana, Alerts, and Bugsink clients share one
Zod-validated HTTP layer (`src/lib/http.ts`); GitHub goes through the `gh` CLI
and screenshots through the `pinchtab` CLI rather than bundled SDKs.
