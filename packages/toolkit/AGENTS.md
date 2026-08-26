# toolkit

The monorepo command hub. It delegates curated platform commands to their
native CLIs with monorepo defaults and owns workflows that are specific to this
repository.

## Commands

```bash
# Development
bun run src/index.ts pr health             # PR health check
bun run src/index.ts deployed scout        # Is a service/commit live on the homelab?
bun run src/index.ts alerts list           # Alert ledger occurrences
bun run src/index.ts bugsink issues        # Bugsink issues
bun run src/index.ts prom query 'up == 0'  # GCX-backed Prometheus query
bun run src/index.ts bk build list         # Native Buildkite CLI with repo defaults
bun run src/index.ts screenshot stocks-sjer-red /   # Visually verify a frontend change

# Build
bun run build                              # Compile to dist/toolkit

# Type checking & tests
bun run typecheck
bun run test

# Install globally
bun scripts/install.ts                    # Installs to ~/.local/bin/toolkit
```

## Structure

```
src/
├── index.ts              # CLI entry point
├── lib/passthrough.ts    # Typed native-CLI registry + transparent runner
├── handlers/             # Command routers
│   ├── pr.ts             # toolkit pr
│   ├── deployed.ts       # toolkit deployed
│   ├── alerts.ts         # toolkit alerts
│   ├── bugsink.ts        # toolkit bugsink
│   ├── history.ts        # toolkit history
│   └── screenshot.ts     # toolkit screenshot
├── commands/
│   ├── pr/               # PR subcommands
│   ├── deployed/         # `deployed` orchestration
│   ├── alerts.ts         # Alert ledger subcommands
│   ├── bugsink/          # Bugsink subcommands
│   ├── history/          # Local agent-history commands
│   └── screenshot/       # `screenshot` orchestration
└── lib/
    ├── github/           # GitHub API via gh CLI
    ├── buildkite/        # Exact-head Buildkite CI evidence
    ├── deployed/         # Commit → homelab deploy trace (git/argocd/kubectl)
    ├── alerts.ts         # Alerts REST API client
    ├── bugsink/          # Bugsink REST API client
    ├── pinchtab-cli/     # PinchTab CLI wrapper (screenshot's browser driver)
    ├── screenshot/       # Package registry + dev-server lifecycle
    ├── history/          # Local agent-history index, source adapters, daemon
    └── output/           # Output formatting
```

## Environment Variables

| Variable              | Description                                                      |
| --------------------- | ---------------------------------------------------------------- |
| `ALERT_DASHBOARD_URL` | Alerts service URL (defaults to the tailnet service)             |
| `BUGSINK_URL`         | Bugsink instance URL (e.g., `https://bugsink.example.com`)       |
| `BUGSINK_TOKEN`       | Bugsink API token                                                |
| `AWS_PROFILE`         | AWS profile for `pr asset` (or pass `--profile`)                 |
| `DISCORD_BOT_TOKEN`   | Discord bot token for `discord daemon start` (optional)          |
| `DISCORD_USER_TOKEN`  | Discord user/selfbot token for `discord daemon start` (optional) |

## Platform passthrough invariants

`src/lib/passthrough.ts` is the single registry for `gh`, `bk`, `git-spice`,
`linear`, `posthog`, `grafana`, `prom`, `loki`, `tempo`, `temporal`, `argocd`,
`cf`, and `tailscale`.

- Inject only the documented monorepo default. An explicit flag or non-empty
  environment value wins.
- Preserve every user argument and the `--` boundary. Do not translate old
  toolkit syntax into native CLI syntax.
- Spawn with inherited cwd, environment, stdin, stdout, and stderr. Do not
  capture, decorate, or log successful passthrough output.
- Mirror the child exit status and signal. A missing native executable prints
  its name and exits 127.
- Keep common plumbing (`git`, `bun`, `kubectl`, `helm`, `tofu`, `aws`, `op`,
  `promtool`, `logcli`) outside the registry.

Use fake PATH executables for subprocess tests. They must prove argument,
stream, environment, exit, signal, and missing-executable behavior without
contacting a service.

## `pr health` — exact-head readiness

PR health keeps the established JSON report shape and exit contract: healthy
and pending exit 0; unhealthy exits 1. Its evidence boundary is deliberate:

- `gh pr view`, `gh pr checks`, and reviews provide PR metadata.
- `git merge-tree` checks the exact fetched PR head against current
  `origin/main`; a fetch or merge-tree failure is an error, never a clean
  result.
- `bk build list --commit <head>` selects the newest exact-SHA build, then
  `bk build view` supplies authoritative jobs and soft-failure metadata.

GitHub Buildkite checks are advisory and may be stale. Never let their state
override the exact-head Buildkite build. Hard failed jobs emit
`toolkit bk job log <id> --agent` commands.

## `deployed` — is my commit/service live on the homelab?

`toolkit deployed [<selector>] [--commit <ref>] [--json] [--no-cluster] [--no-github]`
automates the manual deployment trace: it follows a commit
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

## `screenshot` — visually verify a frontend change

`toolkit screenshot <package> [route] [options]` boots a
registered package's dev server and drives a real PinchTab-controlled
Chrome tab to a route to capture a screenshot — the happy-path way to
confirm a UI change actually renders, without a manual browser session.
Full flag reference and recipes: the `screenshot` skill.

- **Driver: PinchTab, not a new dependency.** `src/lib/pinchtab-cli/client.ts`
  shells out to the `pinchtab` CLI (already-running daemon, same pattern as
  `lib/github/client.ts`'s `gh` wrapper) — no Playwright/Chromium install,
  no second automation stack. Every call scopes itself to a fresh
  `session create`/`session revoke` pair (env-scoped `PINCHTAB_SESSION`, never
  the parent process's own env) so concurrent PinchTab usage is unaffected.
  **Requires a running PinchTab browser instance** (`pinchtab instance start
--profile default --mode headless` if `pinchtab instances` is empty) —
  the daemon itself doesn't auto-start one.
- **Registry:** `src/lib/screenshot/catalog.ts` — alias → `cwd`/`devCommand`/
  `expectedPort`/`defaultRoute`/optional `requiresAuth`. Every run **spawns its
  own** isolated dev server on the fixed `expectedPort` — it never reuses an
  already-running one, because a status probe can't verify that server is
  actually the requested app (an unrelated process, a stale build, or an
  auth-gated stack started without `ENABLE_DEV_LOGIN` could be on that port).
  The bound port is also **not** parsed from stdout (dev commands print
  inconsistent/hard-coded banners — scout's `dev-web.ts` prints a static
  `:5180`). So `expectedPort` must be free: if it's already in use,
  `ensureDevServer` **fails fast** rather than capturing the wrong server or
  auto-bumping to an unknown port. `--env KEY=VALUE` is applied to the spawned
  server's environment.
- **Auth:** `scout-app` is the one auth-gated entry (`requiresAuth:
"scout-dev-login"`) — see `packages/scout-for-lol/AGENTS.md`'s dev-login
  section. `--discord-id` only matters for entries that declare `requiresAuth`.
- **No network mocking in v1** — PinchTab has no `page.route()` equivalent, so
  this can't fake a backend response to force an unreachable state. See the
  skill's Limitations section.
- Out of scope, not in the registry: `scout-for-lol/packages/desktop`
  (Tauri/Rust) and `tasks-for-obsidian` (React Native/Metro).

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

## `history` — search local agent conversations

`toolkit history` searches a private, local FTS5 index built from Conductor,
Claude Code, Codex, Cursor, bundled OpenCode, and standalone OpenCode. It is a
historical recollection tool: it never calls GitHub, ArgoCD, Kubernetes, or
other live services.

```bash
toolkit history daemon install
toolkit history recent --since 7d
toolkit history search "kubernetes ingress" --since 30d
toolkit history show <ID_FROM_SEARCH> --query "kubernetes ingress"
toolkit history sources --json
toolkit history daemon status --json
toolkit history daemon reindex
```

The daemon is a user-scoped macOS LaunchAgent named
`com.jerred.toolkit-history`. It polls every 30 seconds, owns writes to
`~/.toolkit/history/index.sqlite`, and exposes a 0600 Unix socket for status and
reindex requests. The versioned index uses contentless FTS5 title, dialogue,
and tool-output columns with BM25 weights `8.0`, `3.0`, and `0.25`; recency is
only a tie-breaker. Full transcript bodies are never stored in ordinary index
tables. Excerpts and `show` context use batched targeted reads of returned
records.

Search/recent hide the current `CONDUCTOR_SESSION_ID`/`CODEX_THREAD_ID` and
group identical normalized opening prompts in earliest-anchored 30-minute
clusters by default. `--include-current` and `--include-duplicates` override
those behaviors. Search/recent JSON are warning-bearing envelopes; human source
warnings go to stderr. `show` IDs are rebuild-local, and context is capped at
eight messages/6,000 characters by default. Role-aware adapters omit system,
reasoning, and compaction records. Cursor's flattened index uses `unknown`.

Runtime files are private: `index.sqlite`, `daemon.sock`, `state.json`, and
`logs/` are under `~/.toolkit/history/`; the plist is
`~/Library/LaunchAgents/com.jerred.toolkit-history.plist`. `daemon stop` unloads
the job without deleting the plist, while `daemon uninstall` unloads and
removes it. LaunchAgent installation is macOS-only.

Source adapters must inspect only documented conversation tables/files, fail
with a source-specific schema error when a client changes, and report that
error through `history sources` rather than silently claiming coverage. Never
read standalone OpenCode `~/.local/share/opencode/auth.json`; credentials must
not enter the index, excerpts, logs, tests, or commits. Source SQLite files and
JSONL transcripts are always opened/read-only. Cursor may use SQLite's immutable
URI only after ordinary read-only access reports `CANTOPEN` and no live WAL is
present. Use the history skill for the full command recipes and source
boundaries.

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

## `pr review` — see and clear provider findings

`toolkit pr review list <PR>` prints every code-review finding on a PR,
**deduplicated across the surfaces the provider posted it on**. Qodo renders
each finding twice — once inside its persistent review comment, once as an
addressable thread on the offending line — and the two are cleared through
different APIs. `@shepherdjerred/code-review` merges them into one finding
carrying both handles; this shows that, so a `blocking_count` becomes a list of
named problems rather than a number.

`toolkit pr review resolve <PR> --finding <key|title> --evidence <text>` clears
one finding on **both** surfaces in a single step: it appends the
`<code>☑ resolved</code>` chip to the finding in the review comment and replies
to and resolves the review thread. `--evidence` is required — a dismissal
without a reason is indistinguishable from silencing the finding. Chipping only
ever edits the region above `<!-- FOLDED_SECTION_START -->`; everything below is
Qodo's archive of previous results, which the parser excludes.

`toolkit pr review harvest <PR…>` applies the stale-gate rule: a gate that
failed, whose provider has since finished reviewing _this_ head with nothing
blocking, is stale and passes on a re-run. It prints the `toolkit bk job retry` command
by default and only re-runs jobs with `--retry`. The Buildkite job id comes out
of the status URL's fragment, so the failed job is retried rather than the whole
build.

GitHub access borrows an authenticated `gh`'s token when `GH_TOKEN` is unset,
keeping the package's no-token-setup convention; the library needs a token
rather than the CLI because it speaks GraphQL and paginates itself.

## Shared `lib/http` + `lib/config`

The Alerts and Bugsink workflow clients share one HTTP layer instead of each
re-implementing fetch + auth + error handling. Platform passthroughs do not use
this layer.

- **`src/lib/http.ts`** — `createHttpClient({ baseUrl, auth, errorLabel, headers?, normalizeUrl? })`
  returns a client with `get(endpoint, { schema, query? })`, `post(endpoint, { schema, body?, query? })`,
  and `raw(endpoint, { query? })` (text, no JSON parse). All three return the
  standard `{ success, data?, error? }` envelope. `auth` is a discriminated shape —
  `{ scheme: "Bearer", token }` or `{ scheme: "Token token=", token }` — written
  verbatim into the `Authorization` header. Query params are `set` for scalars and
  `append`-ed for arrays. Any thrown error (network failure, non-JSON body, or a
  Zod parse failure) is caught once and flattened to `{ success: false, error }`.
  `normalizeUrl(baseUrl, endpoint)` lets a client own URL construction — Bugsink
  uses it to insert its `/api/canonical/0` prefix via `buildBugsinkApiUrl`.
- **`src/lib/config.ts`** — `requireEnv(name, description)` throws an actionable
  error naming the variable and its purpose when unset/empty; `optionalEnv(name)`
  returns `undefined` when unset/empty. Both read `Bun.env` and treat `""` as
  absent.

Each Alerts/Bugsink client delegates to a `createHttpClient` instance. Do not
route the GitHub, Buildkite, S3, Discord, or native passthrough transports
through it; they have different process and authentication boundaries. Unit
tests live in `test/lib/` (`http.test.ts`, `config.test.ts`),
wired into the `test:unit` glob.

## Adding New Commands

1. For a native platform CLI, add one registry entry and mapping/subprocess
   tests. Do not add a handler.
2. For a monorepo workflow, create a command and handler, then route it in
   `src/index.ts`.
3. Update root/toolkit docs and the relevant repo-owned skill in the same
   change.

## Design Principles

- Prefer native CLIs for platform operations; toolkit supplies only defaults
  and transparent process behavior.
- Keep monorepo orchestration in toolkit-owned workflows.
- Output markdown optimized for Claude Code
- Include actionable commands in error output
- Exit non-zero on unhealthy status
