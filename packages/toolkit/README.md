# toolkit

`toolkit` is the command entrypoint for the complete monorepo stack. It gives
native platform CLIs stable monorepo defaults and retains the workflows that
only make sense in this repository: deployment tracing, PR health and review
media, alert/error triage, screenshots, Discord sessions, and private agent
history.

See [AGENTS.md](AGENTS.md) for implementation invariants and contributor notes.

## Install and run

```bash
# Run from source
bun run src/index.ts pr health

# Compile a standalone binary to dist/toolkit
bun run build

# Install globally to ~/.local/bin/toolkit
bun run install:local
```

## Platform commands

Platform commands delegate to native CLIs. Explicit flags and environment
values override the monorepo defaults.

| Command      | Native CLI       | Monorepo default                                     |
| ------------ | ---------------- | ---------------------------------------------------- |
| `gh`         | `gh`             | `GH_REPO=shepherdjerred/monorepo`                    |
| `woodpecker` | `woodpecker-cli` | Woodpecker CI; server and token from the environment |
| `git-spice`  | `git-spice`      | Current checkout                                     |
| `linear`     | `linear`         | `--workspace sjerred`                                |
| `posthog`    | `posthog-cli`    | Project `549883`                                     |
| `grafana`    | `gcx`            | Context `homelab`                                    |
| `prom`       | `gcx metrics`    | Context `homelab`                                    |
| `loki`       | `gcx logs`       | Context `homelab`                                    |
| `tempo`      | `gcx traces`     | Context `homelab`                                    |
| `temporal`   | `temporal`       | `--profile homelab`                                  |
| `argocd`     | `argocd`         | Homelab server and `--grpc-web`                      |
| `cf`         | `cf`             | Native configured context                            |
| `tailscale`  | `tailscale`      | Native local daemon                                  |

Everything after the selected platform command is preserved, including
`--help`, `--version`, and the `--` argument boundary. The child inherits the
current directory, environment, and terminal streams. Toolkit mirrors its exit
status or signal and returns 127 when the native executable is missing.

```bash
toolkit gh pr view
toolkit woodpecker pipeline ls shepherdjerred/monorepo
toolkit linear issue view SJ-123
toolkit posthog api search read-data-schema
toolkit prom query 'up == 0'
toolkit loki query '{namespace="temporal"} |= "error"' --since 1h
toolkit tempo query --help
toolkit grafana alert rules list
```

Common plumbing such as `git`, `bun`, `kubectl`, `helm`, `tofu`, `aws`, `op`,
`promtool`, and `logcli` stays directly invoked.

## Monorepo workflows

### PR health, reviews, and media

`toolkit pr health [PR_NUMBER] [--json]` combines three independent signals:

- a local merge-tree against freshly fetched `origin/main` and the exact PR
  head;
- the Woodpecker pipeline for that exact head SHA, including authoritative job
  state and `toolkit woodpecker pipeline log show <repo> <pipeline>` investigation commands;
- GitHub PR/check/review metadata from `gh`.

GitHub’s status can lag or describe a different state. The exact-head
Woodpecker pipeline wins when they disagree. Healthy and pending reports exit 0;
unhealthy reports exit 1. JSON retains the top-level `prNumber`, `prUrl`,
`overallStatus`, `checks`, and `nextSteps` fields.

`toolkit pr review list|resolve|harvest` inspects and resolves code-review
provider findings. `toolkit pr asset <PR> <file|dir...> [--markdown]` uploads
the lightest useful review artifact to `public.sjer.red`; directories require
a root `index.html`, and asciinema `.cast` files get a self-contained player.

### Deployment and browser acceptance

`toolkit deployed [SELECTOR]` traces a commit through merge, image publication,
GitOps pinning, ArgoCD sync, and the running pod digest. Selectors include a
service (`scout`), variant (`scout/prod`), or commit. Use `--json`,
`--no-github`, or `--no-cluster` when needed. Deployable services, their
aliases, and variants come from the `@shepherdjerred/ops-model` service catalog,
and reports (including the `service` field of `--json`) name each service by
its catalog id, for example `temporal` or `static-sites`; the older names
`temporal-worker` and `caddy-s3proxy` still work as selectors.

`toolkit screenshot <package> [route]` starts a registered package on its fixed
development port and drives a PinchTab-controlled browser. It fails if the port
is already occupied rather than capturing an unrelated process.

For credential-separated captures, run `toolkit screenshot-server <package>` in
one container and pass its URL to `toolkit screenshot <package> [route]
--base-url <url>` from a separate container. The server container never receives
PinchTab credentials or config.

### Operations and local history

- `toolkit alerts list|show` queries the durable alert occurrence ledger.
- `toolkit ops summary [--json] [--needs-me] [--section ID]` reads the homelab
  ops snapshot, applies the staleness policy, and prints overall severity, one
  line per section, what is waiting on you, and the top attention signals with
  their first link. A non-200 response, unreachable dashboard, or snapshot that
  breaks the `@shepherdjerred/ops-model` contract exits nonzero.
- `toolkit bugsink ...` queries teams, projects, issues, events, stacktraces,
  and releases in self-hosted Bugsink.
- `toolkit discord ...` operates the private local Discord session daemon.
- `toolkit history ...` searches the private, rebuildable local agent-history
  index. It never treats prior conversation as current deployment truth.

#### History search

`history` maintains a private local index of Conductor, Claude Code, Codex,
Cursor, bundled OpenCode, standalone OpenCode, Antigravity, and Grok CLI
conversations. Install the macOS LaunchAgent once; search itself only reads
the index and never performs live service checks.

| Command                                                                      | Description                                   |
| ---------------------------------------------------------------------------- | --------------------------------------------- |
| `history search <QUERY> [--since 7d] [--source NAME] [--limit N]`            | Rank indexed work with BM25                   |
| `history search <QUERY> --include-excerpts`                                  | Add targeted 360-character source excerpts    |
| `history recent [--since 7d] [--limit N]`                                    | List recent indexed sessions                  |
| `history show <ID> [--query TEXT] [--messages 8] [--include-tools] [--json]` | Read bounded, role-aware conversation context |
| `history sources [--json]`                                                   | Show source availability and scan errors      |
| `history usage [--since 7d] [--source NAME] [--json]`                        | Token counts and estimated cost by source     |
| `history daemon install`                                                     | Install and start the macOS LaunchAgent       |
| `history daemon status\|reindex`                                             | Inspect or refresh ingestion                  |
| `history daemon stop\|start\|uninstall`                                      | Manage the LaunchAgent lifecycle              |

```bash
toolkit history daemon install
toolkit history recent --since 7d
toolkit history search "argocd prune" --since 90d
toolkit history show <ID_FROM_SEARCH> --query "argocd prune"
toolkit history sources
toolkit history usage --since 30d
toolkit history usage --since all
```

`--since` accepts `7d`/`24h`/`1w`, an ISO date, or `all` for no lower bound;
omitting it defaults to the last 7 days on every `history` subcommand.

Search ranks title, dialogue, and tool text separately and uses recency only to
break relevance ties. Unquoted terms keep AND-prefix behavior; pass literal
quotes inside the query for an exact phrase, for example
`toolkit history search '"Bryan Bucks"'`. The current Conductor/Codex run and
30-minute parallel duplicates are hidden/grouped by default; use
`--include-current` or `--include-duplicates` when needed. Source failures are
warnings on stderr, or in the JSON `warnings` array.

JSON search and recent output are envelopes (`{ query, results, warnings }` and
`{ results, warnings }`). `show --json` returns
`{ record, messages, truncated }`. Local index IDs can change after a rebuild;
rerun search when an ID is missing.

The rebuildable index is `~/.toolkit/history/index.sqlite`; daemon state,
socket, and logs are in that private directory. The LaunchAgent is
`~/Library/LaunchAgents/com.jerred.toolkit-history.plist`. Transcript bodies
are not copied into ordinary index tables. `show` returns at most eight
messages and 6,000 characters by default, excluding system, reasoning, and
compaction records. Standalone OpenCode's
`~/.local/share/opencode/auth.json` is never read or indexed. Use `deployed`,
`pr health`, or the relevant live client to verify current status after using
history for context.

Antigravity's local conversation databases carry no reconstructible transcript
text (only usage telemetry), so its indexed dialogue is minimal by design —
its value here is the token/cost data, not search.

##### Token and cost tracking

`history usage` reports token counts and an estimated USD cost per source,
populated for the sources whose local data actually carries usage
(Claude Code, Codex, Antigravity, Grok — Cursor, Conductor, and OpenCode
don't appear in the report at all today, since their local data doesn't
reliably carry usage). Cost comes from whichever source is authoritative:
Grok CLI self-reports its own per-turn cost (`costUsdTicks`), which is used
directly; every other source is priced against the shared
`@shepherdjerred/llm-models` catalog. A session using a model the catalog
doesn't price reports its real token counts with `cost_complete: false` and
a null cost — never a fabricated `$0`. These are local estimates for
personal visibility, not authoritative billing.

Usage is tracked per turn/generation, each tagged with when it actually
happened, not as one lifetime total per session — so `--since` filters to
activity within the requested window even for a session that spans the
window boundary, instead of attributing its entire history to whichever
window its most recent message falls in. Codex's `cached_input_tokens` is
priced as a subset already included in its input tokens (OpenAI's cache
discount), distinct from the additive cache-read/cache-write tokens Claude
Code and Antigravity's Claude-backed sessions report.

##### Usage metrics push

When `historyMetricsPushEnabled` is on, the history daemon pushes AI usage and
Brim quota metrics over OTLP/HTTP every 60 seconds to the homelab Alloy
gateway (`otlp-metrics` on the tailnet), which remote-writes them into
Prometheus. It is off by default; enable it in `~/.toolkit/config.toml` and
restart the daemon (`toolkit history daemon stop && toolkit history daemon start`):

```toml
[history.metrics.push]
enabled = true
```

Pushed series are `ai_usage_tokens_total{source,model,type}`,
`ai_usage_cost_usd_total{source,model}`, `ai_usage_events_total{source,model}`,
`ai_usage_unpriced_events_total{source}`,
`ai_subscription_quota_used_ratio{provider,window_id,window_kind}`,
`ai_subscription_quota_reset_timestamp_seconds{provider,window_id}`, and
`ai_subscription_snapshot_timestamp_seconds{provider}`, with
`job="toolkit-history"` and `instance=<hostname>`. Prompts, paths, workspaces,
and session ids never leave the machine.

Because the history index is rebuildable, usage totals come from a separate
ledger, `~/.toolkit/history/usage-export.sqlite`. It remembers a SHA-256 key per
event, so pruning a transcript, reindexing, or restarting the daemon never
lowers or double-counts a total. The first run records existing events without
counting them: enabling the push never backfills history, and events that
predate that seed never count later either. Keys older than 400 days are
pruned. Deleting the ledger restarts the counters from zero. A missing Brim
cache skips quota metrics; a corrupt one is logged as a refresh failure in the
daemon log each scan until Brim rewrites it.

Run `toolkit --help` or a workflow’s `--help` for the complete command surface.

## Configuration

Toolkit behavior settings resolve `environment -> ~/.toolkit/config.toml ->
default`. An explicit value stops resolution, including `false`; an invalid
value or unparseable file is an error, not a fallback.

| Key (env / TOML path)                                             | Default                                               |
| ----------------------------------------------------------------- | ----------------------------------------------------- |
| `HISTORY_METRICS_PUSH_ENABLED` / `history.metrics.push.enabled`   | `false`                                               |
| `HISTORY_METRICS_PUSH_ENDPOINT` / `history.metrics.push.endpoint` | `https://otlp-metrics.tailnet-1a49.ts.net/v1/metrics` |
| `OPS_DASHBOARD_URL` / `ops.dashboard.url`                         | `https://ops.tailnet-1a49.ts.net`                     |

The history daemon runs under launchd without your shell environment, so set
its keys in the TOML file. It reads them once at start.

## Environment variables

Toolkit-owned workflows use these variables. Native passthrough credentials
remain owned by their native CLIs and shell configuration.

| Variable              | Purpose                                     |
| --------------------- | ------------------------------------------- |
| `ALERT_DASHBOARD_URL` | Alerts service URL                          |
| `BUGSINK_URL`         | Bugsink instance URL                        |
| `BUGSINK_TOKEN`       | Bugsink API token                           |
| `AWS_PROFILE`         | AWS profile for `pr asset`                  |
| `DISCORD_BOT_TOKEN`   | Bot identity for `discord daemon start`     |
| `DISCORD_USER_TOKEN`  | Userbot identity for `discord daemon start` |

## Development

```bash
bun run typecheck
bun run lint
bun run test
bun run build
bun run test:integration
```

`src/index.ts` separates platform passthroughs from monorepo workflow routers.
The typed passthrough registry and subprocess runner live in
`src/lib/passthrough.ts`; service-specific workflow code lives under
`src/commands/` and `src/lib/`.
