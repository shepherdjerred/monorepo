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

# Compile a standalone binary to dist/toolkit (ad-hoc signed on macOS)
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

### Wait for CI and merge readiness

`toolkit ci maintenance --json` reports recent explicit maintenance runs and
the durable Temporal coordinator's memo key. It distinguishes release notes, CI
image refreshes, and superseded source requests from normal main recovery.
Maintenance success is never merge-readiness evidence. Inspect a failed or
ambiguous submission and its coordinator state before retrying it.

```bash
toolkit ci wait                         # Infer the PR for this branch
toolkit ci wait 3447 --json             # One final report; progress on stderr
toolkit ci wait 3447 --until settled    # Collect all blocking check results
toolkit ci wait 3447 --timeout 2h       # Optional deadline; no default deadline
toolkit ci explain 3447                # Current blockers and bounded failure logs
toolkit ci main                        # Current main verification and last completed verdict
toolkit ci load                        # Queue, compute/gate admission, CPU/memory/disk/I/O
toolkit ci timings --since 72h --json   # Recent timing cohorts and per-workflow phases
toolkit pr review list 3447 --json      # Human and provider feedback with full bodies
```

CI commands resolve `WOODPECKER_TOKEN` through the registered credential broker,
as the native Woodpecker command does. An explicit token retains precedence;
custom server URLs or repository IDs require an explicit token.

`wait` pins the initial PR head (or asserts `--head <full SHA>`), subscribes to
Woodpecker events before reading status, and refreshes GitHub metadata every
30 seconds. It returns as soon as a blocking check fails, merge conflicts
appear, human intervention is needed, or all merge requirements pass. A ready
candidate gets a fresh check of head, base, pipeline attempt, rules, and main.
`--until settled` waits for the remaining blocking results after a CI failure;
head changes and structural blockers still return immediately.

PR observation considers both normal PR pipelines and signed ready-for-review
metadata pipelines for the exact head. Title and label changes cannot replace
verification evidence. A green draft preflight cannot make a ready PR mergeable;
the full pipeline and its own published completion verdict must pass.

Woodpecker workflow results and the `ci-complete` gate determine hard CI
failures. Failed service cleanup children inside successful workflows do not
block a merge. Required GitHub checks must also publish success for the current
pipeline; optional external checks are advisory. Human approval is required
only when the effective branch rules require it, or a human requests changes.
A branch behind main is acceptable when the branch rules do not require it
to be current.

Long queues and builds are normal. Keep awaiting the same foreground process;
do not restart polls or diagnose an outage from elapsed time alone. A sparse
heartbeat appears every five minutes. Disconnects reconnect with backoff and a
fresh snapshot. `load` reports each unavailable telemetry source explicitly.

`explain` and wait reports include pipeline elapsed time, workflow start delays,
time without any active workflow, and per-step API phase timings in JSON. The
report identifies the pipeline attempt and numeric workflow IDs. The string
`taskId` matches the native pod task-UUID label: Woodpecker 3.19 uses the workflow
ID's decimal representation for both its queue and backend task ID. API phase timings
include admission and pod startup; they are not process CPU time. Parallel phases
overlap and must not be added together to estimate elapsed pipeline time.
Missing timestamps remain unknown, including activity totals with incomplete
workflow evidence. Live intervals account for local clock skew. Completion delay
is a lower bound because the pipeline API does not identify required dependencies.

`timings` reads every pipeline created in the requested window, with four detail
requests at a time. It groups actual workflow shapes into draft, noop, ready PR,
main, maintenance, and other work, then separates attempts and outcomes. Each
cohort reports successful latency sample counts and nearest-rank p50/p95 values;
failed or canceled runs do not become successful latency samples. Individual
step distributions expose checkout, review, verification, publication, and
deployment costs. They overlap and are not additive. Structured checkout and
toolchain measurements are reported separately from native step durations;
toolchain bootstrap excludes workspace dependency installation. Checkout byte
counts measure stored Git objects, not network traffic.

The native API exposes only the latest attempt. The command also reads successful
clone, review, verification, draft-preflight and maintenance command logs, with
four concurrent requests and an 8 MiB limit per step. Missing, malformed or
oversized evidence stays unknown; raw logs are never copied into the report.
Final structured review signals distinguish exact-head completion during this
pipeline (`fresh`), completion before it (`reused`), both (`mixed`), and a gate
passing solely on quota exemptions. Provider details preserve partial quota
coverage; the existing gate can pass with one completed provider. Rounded
timestamps at the run boundary remain unknown. Historical full verification of
drafts also has its own cohort. At least 30 distinct fresh successful ready heads
are needed to assess the target p95. This sample includes `mixed` gates with a
proven fresh provider while preserving their separate cohort. Reruns are excluded
and duplicate heads use the slowest eligible success. Sample sufficiency alone
does not certify the SLO.

Main is checked automatically. Push runs and full manual main runs contribute
to its verdict. A manual run must include verification, release admission,
image publication, chart publication and ArgoCD reconciliation without skipped
workflows; partial manual jobs cannot clear a failure. A failed last completed
run keeps main red while its recovery build is pending. When main is red, report its evidence and
await instructions; do not independently fix it. `ci explain --main` is an
alias for `ci main`.

| Wait exit | Meaning                                                       |
| --------- | ------------------------------------------------------------- |
| 0         | Merge ready                                                   |
| 1         | Blocking check failure or merge conflict                      |
| 2         | Usage, authentication, API, or contract error                 |
| 3         | Human intervention (review, draft, pipeline approval)         |
| 4         | PR head changed; explicitly start a new wait for the new head |
| 5         | Main red; report and await instructions                       |
| 6         | Requested timeout; this does not mean CI failed               |
| 7         | PR closed or already merged                                   |

`--json` reserves stdout for one final JSON report. Failure reports include up
to three failed workflows with at most 60 lines / 4,000 characters of logs
each, review excerpts when relevant, and commands for deeper evidence.
Secrets and terminal control sequences are removed before truncation.
`explain` is a one-shot diagnostic; a pending report exits 0 and has
`ready: false`. SIGINT and SIGTERM cancel the foreground wait with exits 130
and 143. The command does not merge or mutate the PR.

GitHub credentials come from `GH_TOKEN` or `gh auth token`.
The default Woodpecker connection resolves `WOODPECKER_TOKEN` through the
registered credential broker, preserving environment and credential-locator
config overrides. The broker uses `OP_SERVICE_ACCOUNT_TOKEN` or the enrolled
macOS Keychain credential for 1Password authentication. Custom `WOODPECKER_URL` or
`WOODPECKER_REPO_ID` connections require an explicit token. Load telemetry
uses the configured `kubectl` context and `gcx --context homelab`.

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

`toolkit pr review list [PR] [--json] [--all] [--provider NAME]` lists current,
unresolved feedback across human reviewers and registered providers. Each item
includes author, provider, nullable priority, full contents, path/line,
resolution state, and a `toolkit gh api` command for the original surface.
Omitting PR infers the current branch; `--all` includes resolved/outdated items.
`resolve` and `harvest` retain the existing provider finding handles.
`toolkit pr asset <PR> <file|dir...> [--markdown]` uploads
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
- `toolkit mc ...` drives disposable Minecraft sandboxes through the
  mc-harness daemon. See [Minecraft sandboxes](#minecraft-sandboxes).
- `toolkit history ...` searches the private, rebuildable local agent-history
  index. It never treats prior conversation as current deployment truth.

#### Minecraft sandboxes

`toolkit mc` is a thin client for the `@shepherdjerred/mc-harness` daemon. The
daemon runs from the monorepo checkout (`bun run
packages/mc-harness/src/daemon/main.ts`), needs Docker, and stages the
repo-built MCBridge plugin, so build it first:

```bash
mise exec -- gradle -p packages/the-storm/plugin :bridge:assemble
toolkit mc daemon start [--ttl 4h]
toolkit mc sandbox up [--profile paper] [--provider docker|kubernetes] [--world flat|void] [--ttl 2h] [--keep]
toolkit mc info
toolkit mc we --world world --pos1 0,-60,0 --pos2 4,-56,4 "//set stone"
toolkit mc region read --world world 0,-60,0 4,-56,4
toolkit mc we-undo
toolkit mc sandbox down --all
toolkit mc daemon stop
```

A sandbox is Paper 26.2 with WorldEdit and MCBridge in a local container, or
with `--provider kubernetes` (the default for the `storm-prod` and
`storm-candidate` profiles) a pod in the cluster's `mc-sandbox` namespace
reached through `kubectl port-forward`. Its
game, RCON, and bridge ports are published on `127.0.0.1` only; the bridge
token and RCON password live in `~/.toolkit/mc/sandboxes/<id>/record.json`
(mode `0600`) and never appear in command output. `--target <id>` selects a
sandbox; without it the command uses the only running one and fails when there
are none or several. A sandbox is removed when its TTL expires or the daemon
stops, unless it was created with `--keep`. There is no live-server target yet.

Coordinates may be negative anywhere (`--pos1 -3,-60,-3`, `region read
-6,-61,-6 6,-44,6`, `cmd tp agent -60 0`); no `--opt=` or `--` is needed.
`toolkit mc <command> --help` prints that command's usage. Each `we` op reports
`changed N`, the blocks whose state really changed; WorldEdit's own "blocks
affected" message counts attempted sets and can be higher.

| Command                                                   | Purpose                                        |
| --------------------------------------------------------- | ---------------------------------------------- |
| `mc cmd <command…>`                                       | Console command with captured feedback         |
| `mc we --world w [--pos1] [--pos2] [--at] "//cmd"`        | WorldEdit as the `agent:<session>` actor       |
| `mc we-undo [--steps n]`                                  | Undo that session's WorldEdit history          |
| `mc paste --world w --file f.schem --at x,y,z [--rotate]` | Paste a Sponge schematic through WorldEdit     |
| `mc region read --world w <a> <b> [--out f.json]`         | Exact block states and palette counts          |
| `mc snapshot create\|ls\|get\|restore`                    | Server-side `.schem` snapshots for undo        |
| `mc info`, `mc players`, `mc events`, `mc logs`           | Versions, players, bridge events, console tail |
| `mc registry --out f.json`                                | Block registry (input to mc-build's registry)  |
| `mc actor spawn\|ls\|observe\|act\|quit`                  | Citizens test actors (paper, storm-dev)        |
| `mc playtest run <file\|dir…> [--profile] [--target]`     | Run scenario files; reports under `runs/`      |
| `mc playtest ls\|show <run-id>\|new <name>`               | Past runs, one report, scaffold a scenario     |

Every command accepts `--json`. The daemon logs requests (never secrets) to
`~/.toolkit/mc/logs/`. `cmd`, `we` and `paste` accept `--record <buildDir>` to
append the op to a build's op log once it succeeds.

#### Minecraft builds

`toolkit mc build …` runs the mc-harness build CLI from the checkout (it needs
the `@shepherdjerred/mc-build` registry, renderer and compile child, which stay
out of the compiled binary). A build directory holds `build.json`, the op log,
the captured site and renders; the repository `minecraft-building` skill
(`.agents/skills/minecraft-building`) describes the loop.

```bash
toolkit mc build init ./cottage --name cottage --world world --anchor 26,-60,26
toolkit mc build capture ./cottage --target <id> --world world 20,-61,20 40,-45,40
toolkit mc build canvas ./cottage                # void sandbox seeded with the site
toolkit mc build compile ./cottage               # build.ts → schematic paste op + lint
toolkit mc build import ./cottage house.litematic --at 26,-60,26   # .litematic/.schem
toolkit mc build import ./cottage statue.obj --height 24 --solid   # OBJ mesh → blocks
toolkit mc build run ./cottage                   # reset canvas, replay ops, freeze result
toolkit mc build render ./cottage                # contact sheet PNG
toolkit mc build replay ./cottage                # fresh sandbox, diff against the frozen result
toolkit mc build promote ./cottage --target <id> [--confirm <planHash>]
toolkit mc build undo <applyId>
```

Promote refuses when the target no longer matches the captured site, requires
the plan hash from its dry run, takes an undo snapshot, pastes the frozen
canvas result, and verifies it cell by cell. Applies are journaled under
`~/.toolkit/mc/journal/<target>/`.

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

## Credentials

Run supported toolkit commands directly; they resolve their registered
credentials before dispatch. Each credential uses the first available source:

1. A non-empty environment variable.
2. Its entry in `~/.toolkit/config.toml` under `[credentials]`, containing an
   `op://` reference or `keychain:<service>` locator.
3. Its registered backend below.

Native passthroughs invoked with exactly `--help`, `-h`, or `--version`, plus
the exact invocation `toolkit argocd version --client`, run without credential
resolution. ArgoCD also supports a bare subcommand path ending in `--help` or
`-h`, such as `toolkit argocd app rollback --help`, and the equivalent
`toolkit argocd help app rollback` form (including root `argocd help`). The help
subcommand remains credential-free with global options and `--` operands;
option values and application names equal to `help` retain authentication.
Their arguments, native output, and exit status are preserved.
These ArgoCD invocations also remove `ARGOCD_AUTH_TOKEN` from the child
environment because native help prints its default value. Server commands
continue to inherit the configured token.
Other invocations still resolve credentials, including `argocd version` and
commands carrying metadata flags as arguments or after `--`.

| Commands                                                                                                | Registered backend        |
| ------------------------------------------------------------------------------------------------------- | ------------------------- |
| `woodpecker`, `pr`, `linear`, `posthog`, `cf`, `argocd`, `grafana`, `prom`, `loki`, `tempo`, `temporal` | 1Password service account |
| `bugsink`, `discord`                                                                                    | macOS Keychain            |

The registry in `src/lib/credentials.ts` owns the variable names and secret
locators. Backend failures are errors; a missing Keychain secret does not
automatically fall through to 1Password. A config override selects a different
backend explicitly. Toolkit logs credential names and backends, never values.
The native Temporal CLI performs authentication, while toolkit supplies its
`TEMPORAL_API_KEY` for external addresses. Toolkit skips that credential lookup
when the effective address is the exact in-cluster service; an explicit
`--address` takes precedence over `TEMPORAL_ADDRESS` for this decision.

For the 1Password backend, `OP_SERVICE_ACCOUNT_TOKEN` wins. Otherwise, on
macOS, toolkit reads the enrolled service account from Keychain and invokes
`op` with that token. If the command reports missing enrollment, use the
repository's existing setup from its root:

```bash
swift scripts/onepassword/enroll-service-account.swift
```

Outside macOS, supply `OP_SERVICE_ACCOUNT_TOKEN` through the existing secret
manager integration. For Bugsink and Discord, a missing credential error names
the exact workstation-secret enrollment command. Never paste tokens into chat,
CLI arguments, or the toolkit config file; the config stores locators only.

`ci` uses the registered `WOODPECKER_TOKEN` credential for the default
connection, unless `WOODPECKER_TOKEN` is supplied in the environment. The
credential broker can bootstrap its 1Password service account from
`OP_SERVICE_ACCOUNT_TOKEN` or the enrolled macOS Keychain credential. Custom
Woodpecker URLs or repository IDs require an explicit token. CI help and
argument validation run before credentials are resolved. GitHub access uses
`GH_TOKEN` or `gh auth token`.
Commands such as `gh`, `temporal`, and `tailscale` retain native authentication;
S3 workflows retain the AWS credential chain.

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

Toolkit-owned workflows use these variables. The credential broker supplies
registered token variables automatically; native authentication and AWS
profiles remain owned by their respective clients.

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
