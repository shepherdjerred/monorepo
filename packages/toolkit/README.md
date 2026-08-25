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

| Command     | Native CLI    | Monorepo default                  |
| ----------- | ------------- | --------------------------------- |
| `gh`        | `gh`          | `GH_REPO=shepherdjerred/monorepo` |
| `bk`        | `bk`          | Buildkite organization `sjerred`  |
| `git-spice` | `git-spice`   | Current checkout                  |
| `linear`    | `linear`      | `--workspace sjerred`             |
| `posthog`   | `posthog-cli` | Project `549883`                  |
| `grafana`   | `gcx`         | Context `homelab`                 |
| `prom`      | `gcx metrics` | Context `homelab`                 |
| `loki`      | `gcx logs`    | Context `homelab`                 |
| `tempo`     | `gcx traces`  | Context `homelab`                 |
| `temporal`  | `temporal`    | `--profile homelab`               |
| `argocd`    | `argocd`      | Homelab server and `--grpc-web`   |
| `cf`        | `cf`          | Native configured context         |
| `tailscale` | `tailscale`   | Native local daemon               |

Everything after the selected platform command is preserved, including
`--help`, `--version`, and the `--` argument boundary. The child inherits the
current directory, environment, and terminal streams. Toolkit mirrors its exit
status or signal and returns 127 when the native executable is missing.

```bash
toolkit gh pr view
toolkit bk build list --pipeline monorepo --branch main
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
- the Buildkite build for that exact head SHA, including authoritative job
  state and `toolkit bk job log <id> --agent` investigation commands;
- GitHub PR/check/review metadata from `gh`.

GitHub’s Buildkite status can lag or describe a different state. The exact-head
Buildkite build wins when they disagree. Healthy and pending reports exit 0;
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
`--no-github`, or `--no-cluster` when needed.

`toolkit screenshot <package> [route]` starts a registered package on its fixed
development port and drives a PinchTab-controlled browser. It fails if the port
is already occupied rather than capturing an unrelated process.

### Operations and local history

- `toolkit alerts list|show` queries the durable alert occurrence ledger.
- `toolkit bugsink ...` queries self-hosted Bugsink and can resolve an explicit
  reviewed issue UUID allowlist through the canonical REST API.

To preview or apply a reviewed resolution set:

```bash
toolkit bugsink resolve <ISSUE_UUID...> --dry-run
toolkit bugsink resolve --from-file issues.txt --confirm
```

Resolution always preflights every target, refuses missing or muted issues, and
verifies each successful REST action with a follow-up API read. `--confirm` is
required for changes; the command never uses the Bugsink web UI and does not
support muting or broad selector-based cleanup.

- `toolkit discord ...` operates the private local Discord session daemon.
- `toolkit history ...` searches the private, rebuildable local agent-history
  index. It never treats prior conversation as current deployment truth.

#### History search

`history` maintains a private local index of Conductor, Claude Code, Codex,
Cursor, bundled OpenCode, and standalone OpenCode conversations. Install the
macOS LaunchAgent once; search itself only reads the index and never performs
live service checks.

| Command                                                                      | Description                                   |
| ---------------------------------------------------------------------------- | --------------------------------------------- |
| `history search <QUERY> [--since 7d] [--source NAME] [--limit N]`            | Rank indexed work with BM25                   |
| `history search <QUERY> --include-excerpts`                                  | Add targeted 360-character source excerpts    |
| `history recent [--since 7d] [--limit N]`                                    | List recent indexed sessions                  |
| `history show <ID> [--query TEXT] [--messages 8] [--include-tools] [--json]` | Read bounded, role-aware conversation context |
| `history sources [--json]`                                                   | Show source availability and scan errors      |
| `history daemon install`                                                     | Install and start the macOS LaunchAgent       |
| `history daemon status\|reindex`                                             | Inspect or refresh ingestion                  |
| `history daemon stop\|start\|uninstall`                                      | Manage the LaunchAgent lifecycle              |

```bash
toolkit history daemon install
toolkit history recent --since 7d
toolkit history search "argocd prune" --since 90d
toolkit history show <ID_FROM_SEARCH> --query "argocd prune"
toolkit history sources
```

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

Run `toolkit --help` or a workflow’s `--help` for the complete command surface.

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
