# AGENTS.md

Bun workspaces monorepo — a single root workspace (`workspaces` in the root
package.json), ONE root `bun.lock`, and the **isolated linker** (root
`bunfig.toml`): strict per-instance dependency/peer resolution, so phantom
deps and hoisting split-brain cannot happen. Internal deps use `workspace:*`
(live symlinks — no copy staleness, no per-package lockfile drift). `bun
install` once at the root covers every package. Optional per-machine speedup:
`globalStore = true` in `~/.bunfig.toml` (deliberately NOT committed — parallel
CI installs against a shared store hit oven-sh/bun#12917).
Use `bun` commands exclusively (never npm/yarn/pnpm).

## Structure

```
packages/
├── anki/                       # Anki flashcard tools
├── astro-opengraph-images/     # Astro OpenGraph image generation (npm)
├── better-skill-capped/        # Browser extension
├── birmel/                     # Discord bot (AI SDK explicit agent runtime)
├── cooklang-for-obsidian/      # Cooklang Obsidian plugin
├── cooklang-rich-preview/      # Cooklang rich link preview site
├── discord-plays-pokemon/      # Discord Plays Pokemon (headless emulator + Go-Live stream)
├── docs/wiki/                  # Human-first public systems wiki
├── dotfiles/                   # Dotfiles & shell config (chezmoi source)
├── eslint-config/              # Shared ESLint flat config (workspace-internal)
├── fonts/                      # Custom fonts
├── home-assistant/             # Type-safe Home Assistant client + codegen
├── homelab/                    # Homelab infrastructure (K8s, cdk8s, Tofu)
├── leetcode/                   # LeetCode practice
├── llm-observability/          # LLM tracing/metrics package
├── monarch/                    # Transaction categorization pipeline
├── resume/                     # Resume site
├── scout-for-lol/              # League of Legends match analysis (backend + web app + desktop)
├── sjer.red/                   # Personal website
├── starlight-karma-bot/        # Discord karma bot
├── stocks-sjer-red/            # Stocks static site
├── tasknotes-core/             # Shared Rust core (domain, sync, recurrence) + UniFFI bindings
├── tasknotes-fixtures/         # Language-neutral JSON oracles shared by the TS and Rust cores
├── tasknotes-macos/            # Native macOS TaskNotes app (SwiftUI over the Rust core)
├── tasknotes-server/           # TaskNotes sync server
├── tasknotes-types/            # TaskNotes shared types
├── tasks-for-obsidian/         # React Native task app
├── temporal/                   # Temporal workflows, schedules, and agent-task scheduler
├── terraform-provider-asuswrt/ # Terraform provider for AsusWRT
├── toolkit/                    # CLI developer tools (pr, pd, bugsink, grafana)
├── trmnl-dashboard/            # TRMNL e-ink dashboard
├── version-catalog/             # Language-neutral image/chart version catalog
├── webring/                    # Webring component (npm)
scripts/                        # Repo automation (setup-free): checks, deploys, release, hooks
.buildkite/pipeline.yml         # Canonical Buildkite CI pipeline (main selects a subset of these steps)
sandbox/                        # Personal scratch (not shipped, excluded from most lint/CI)
├── archive/                    # Legacy projects (do not modify): bun-decompile, castle-casters, clauderon, glance, hn-enhancer, macos-cross-compiler, tips
├── poc/                        # Proof-of-concept experiments (e.g. interview-practice CLI)
└── practice/                   # Coding practice (Exercism, LeetCode, courses, books)
```

## Engineering Principles

- **No type assertions** — Never use `as` casts. The `custom-rules/no-type-assertions` ESLint rule bans all assertions except `as const` / `as unknown`. Narrow untyped data with Zod `.parse()`, `typeof`, or `Array.isArray()` instead of casting.
- **Fail fast on missing tools** — Local/build scripts must call required tools directly. Never `which X && X || echo "skipping"`; a missing tool should error so the developer knows what to install.
- **No defensive fallbacks for bad data** — Fix the root cause (refresh data, add the enum value, fix routing). Never replace a `throw` with a warning + default for unknown enums, missing assets, or unexpected shapes. Exception: user input at a system boundary (e.g. a Discord slash-command arg) should be caught and answered with a friendly message, not Sentry'd.
- **Let contract violations fail loudly** — When `null` or an exception signals a broken caller contract, let it propagate (e.g. an NPE). Don't add null guards or defensive checks that silently hide the bug; reserve null-handling for real boundary inputs (user data, external API responses).
- **Fix, don't ignore** — Never suppress build/CI/Renovate/lint errors with ignorePaths or exclusions. Investigate the root cause; only exclude when the thing genuinely shouldn't be processed.
- **Fix forward on dependency upgrades** — When an upgrade breaks CI, migrate the code to the new version (read the migration guide, use `validate` tooling to catch every schema change) rather than reverting.
- **"Pre-existing" is not an excuse** — When a task or audit targets 100% quality, fix issues regardless of who introduced them. Never leave something broken as "not caused by my changes."
- **Never skip tests** — Don't use `test.skip` / `describe.skipIf` to work around missing build artifacts or generated types. Make the test script produce the prerequisite first (e.g. `"test": "bun run build && bun test"`).
- **Don't blame the cache** — Docker layer cache and turbo's cache are deterministic; different results mean different inputs. Reproduce locally with `bunx turbo run <task>` / `docker buildx build` and compare base images / dependency versions / task inputs instead of citing "transient cache issues."
- **Step back on complexity spirals** — After ~2 failed debugging iterations on the same problem, stop adding workarounds; re-evaluate the approach and present the constraint to the user rather than piling on layers.
- **Verify before asserting** — Don't write a subagent's claim or your own inference into a plan/report as "confirmed." Grep the live tree (`.buildkite/pipeline.yml`, `lefthook.yml`, root `package.json` `verify` script, per-package `turbo.json`) yourself before stating any CI/lint/gate wiring fact; audits often run against a stale base.
- **Don't validate a replacement against the signal it replaces** — When building something to work around an unreliable upstream (e.g. GitHub's `mergeable` field, a flaky check), validate against an independent oracle (fixtures, golden files, the underlying tool, a semantic property like determinism), never the untrusted signal itself.
- **Verify link liveness** — Every URL you write or rewrite (code, docs, READMEs, package metadata) must be liveness-checked (`curl -sI -o /dev/null -w '%{http_code}' <url>` → 200) before committing. Batch-verify mass rewrites; fall back to a known-good form or drop the link rather than ship a 404.
- **Update docs with code** — When adding a CLI command or feature, update CLAUDE.md and the relevant skills in the same phase, not a later "polish" pass, so the integration points are usable as soon as the feature works. When a change alters a meaningful architecture boundary, operator workflow, or system rationale, also update the nearest human page under `packages/docs/wiki/src/content/docs/`.
- **Shared data is language-neutral** — Cross-package shared data (catalogs, config) belongs in a language-neutral source of truth (JSON + JSON Schema), validated per-language (Zod in TS, Pydantic in Python). The repo has Bun and Python consumers; don't ship a TS-only module. If TS needs it browser- and node-safe, ship a built package with inlined JSON + `.d.ts`, not a `node:fs` read or a source-only JSON import.

### Local 1Password and Cloudflare credential probes

On the local macOS/Conductor machine, 1Password Desktop integration authenticates
individual CLI operations through the desktop app and biometric approval. It does
not necessarily create a persistent shell session. Therefore `op whoami` can
return `account is not signed in` while the real operation succeeds. Do not run
`op signin`, ask the user to paste a token, or stop based on `op whoami` alone:
probe with `op vault list` or the exact `op item get`/`op read` needed by the task.

The local `cf` wrapper receives `CF_API_TOKEN` from the shell environment and
maps it to `CLOUDFLARE_API_TOKEN` only for the `cf` process. `cf auth list` only
lists saved named profiles, so an empty list is expected when environment-token
authentication is in use. Use `cf auth whoami` or a read-only API operation such
as `cf accounts list` to test access. Keep authentication and authorization
separate: a valid-token response followed by a 403 means the token lacks the
requested Cloudflare permission (for example, `Account API Tokens Write`), not
that 1Password is signed out. Never expose or persist the token value.

### ArgoCD root prune safety

The homelab CI reconcile script must require an exact root `apps` chart
revision and render that revision before running a pruned sync. Compare the
root's tracked `Application` resources to that rendered source; every live
child absent from the exact desired revision is a prune candidate and must use
the `ci.sjer.red/application-lifecycle: cascade` annotation plus the Argo
resources finalizer. Do not classify candidates from `OutOfSync` or
`requiresPruning` alone: the selective manifest-override sync temporarily
marks unselected retained children as requiring prune.

Main releases must use `argocd.ts release-root` with the exact apps revision,
release inventory, and Buildkite request UUID. One process owns root staging,
child preflight and reconciliation, exact-wave restoration, verified pruning,
and scoped health. Every bounded internal operation, including root staging and
each child reconciliation, retains that request UUID, the revision, its resource
selection, and a `stage`, `batch`, `prune`, or `child` phase marker, so an
interrupted release adopts only its own in-flight operation and never unrelated
work. A retry resumes at whichever root phase is still live rather than
restarting at staging, which cannot adopt a `batch` or `prune` operation.
Adoption compares the live operation against the complete operation this
process would have produced, not only its identity: prune mode, manifest
override, resource selection, and the sync options admission merges in. Those
options are expected only where admission applies, so the root Application,
which the release policy withholds the managed label from, is expected to carry
none even though it declares some. The comparison is closed-world, so any field it
cannot account for is refused rather than ignored, and an operation sharing the
UUID, revision, and phase marker but applying different work never gets
adopted.

The apply-safety preflight inspects the revision the sync will request, not the
Application's currently configured source, including resources that revision
introduces, whose live state it reads directly because `managed-resources`
describes only the configured revision. Every immutable field declares both
what omitting the whole field means and what a key found only in the live value
means, because dropping a key inside a declared field is as rejectable as
changing one; only fields the API server populates keys inside, such as a
StatefulSet's claim templates, compare the declared keys alone. Where that
tolerance would hide an author-owned removal, the preflight descends into the
list with the entry kind's own rules — a claim template is compared as a
PersistentVolumeClaim, matched by name — so the classification comes from one
reviewed table rather than a second list of server-defaulted keys that would
drift with every Kubernetes release. It compares only what the sync will
actually send: an Application declaring `ignoreDifferences` together with
`RespectIgnoreDifferences=true` keeps those paths at their live values, so the
preflight prunes them from both sides instead of refusing a change the API
server never sees — the itzg Minecraft chart moves label values inside
`volumeClaimTemplates` on every bump, which those Applications already ignore
for exactly that reason. The relaxation is narrow: without
`RespectIgnoreDifferences=true` the field is still applied and still checked,
and only `jsonPointers` are honored, because a selector the preflight cannot
resolve must exempt nothing. Only the self-managed root Application
remains auto-sync suspended while those operations run.

Ordinary manual or UI root syncs are supported. Admission merges each managed
child Application's declared sync options into the requested operation, with
the declared value winning by key, and deterministic waves put admission,
secret controllers, providers, certificates, queues, and workloads in
dependency order. Only the recursive `apps` Application ignores child health.
Deleting a managed Application is admission-protected by the retain-or-cascade
lifecycle contract; that policy matches the labeled children plus the
explicitly named root, and leaves unmanaged Applications deletable.
`release-root` binds the release inventory's `apps` revision to `--revision`
and validates the whole inventory against the exact rendered root revision
before it stages anything, so semantically invalid release input cannot leave
prerequisites applied and child auto-sync suspended.

## Code Review Rules

These rules steer automated PR code review. Qodo is the repository-required CI
provider, and consumers that decide against the gate — PR fleet — default to it
too, so their findings cannot disagree with the check that blocks the PR.
`resolveProvider()` keeps a separate neutral default for callers that are not
reproducing a gate decision.
The gate implementation remains provider-neutral — see
`@shepherdjerred/code-review` and the `review-gate` Buildkite step. These rules
apply repo-wide; per-package `AGENTS.md` files add more.

- **Review against the `AGENTS.md` hierarchy** (root + `packages/*/AGENTS.md`) — it
  is the source of truth. Flag deviations from it; do not restate it.
- **Assume mechanical checks pass.** ESLint, prettier, typecheck, and the repo
  checks run separately in CI — don't duplicate them. Focus on what humans/tools
  miss: architecture, correctness, secret hygiene, and process.
- **Enforce the Engineering Principles above.** Flag: type assertions (`as`, outside
  `as const`/`as unknown`); `any`/implicit-any/loose types; silent fallbacks or
  swallowed errors where fail-fast is required; defensive guards that hide a broken
  caller contract; suppressions of build/lint/CI errors; the banned automation
  patterns (`|| true`, `2>/dev/null`, `git add -A`, tokens written to files, …).
- **Process invariants.** `temporal-agent-task` blocks must match the schema;
  prefer Bun-runtime APIs; ensure Prisma teardown in tests; follow the K8s/cdk8s
  and git-spice conventions.
- **Severity discipline.** Only flag genuine issues (P0–P2); skip nits and anything
  a linter would catch. A clean diff should get a clean review.

## Commit and PR Metadata

Before creating or updating a feature PR, apply this checklist to the complete
branch diff:

- Every commit subject uses `type(scope): outcome`, names the behavior or result,
  and avoids placeholders such as `update`, `changes`, `fix stuff`, `WIP`, or
  `address feedback` without saying what changed.
- The primary commit for a branch has a useful body with `Why`, `What`, and
  `Verification` sections. Verification names exact commands and states any
  live or production checks that were not run.
- A PR title describes the complete branch outcome, not merely its first file,
  commit, or implementation step.
- A PR body is synthesized from the complete `base...branch` diff and contains
  `Why`, `What`, and `Verification`. Add rollout notes or follow-up boundaries
  when they affect reviewer acceptance.
- Use `git-spice --fill` only as an optional draft or diagnostic. Inspect the
  full branch diff and submit reviewed metadata explicitly with
  `git-spice branch submit --title ... --body ...`.
- After review changes, keep the PR narrative stable and use
  `git-spice ... submit --update-only`; do not regenerate it blindly from
  follow-up commits.
- For user-visible changes, attach the required screenshot, GIF, video, or
  other lightest artifact that proves the behavior.

## Documentation Discipline

Do not create per-session journals or append session summaries to repository
documents. Ordinary Q&A, investigations, and small fixes need no documentation
artifact solely because an agent worked on them.

Track plans, open work, human-review queues, and implementation follow-ups in
Linear. Do not add a parallel repository-local workflow-document system.

The human wiki (`packages/docs/wiki/`) is structured on
[Diátaxis](https://diataxis.fr/): every page is exactly one of a tutorial,
how-to guide, reference, or explanation, and never a blend. Load the `diataxis`
skill before authoring there.

- The primary artifact for a code-changing session is a pull request. Create a
  draft PR from the feature branch as soon as it contains a coherent first commit,
  and promote it to ready for review only after verification is complete.
- Keep every agent-created write in the active checkout. Do not leave duplicate
  or partial work in another checkout.
- Record unfinished work in Linear, the PR description, or the final response;
  do not create a journal just for handoff.

Repository lifecycle hooks are scoped to local CLI runtimes and must exit
immediately in hosted or web environments.

## Automation Code — Banned Patterns

These patterns are banned in automation code (`scripts/`, `.buildkite/`, deploy/build scripts). `scripts/check-suppressions.ts` scans the staged diff for them (`|| true`, `2>/dev/null`, `|| bun install`, `x-access-token`, `git add -A`, `--no-exit-code`) and runs in the `pre-commit` hook (`lefthook.yml`) plus the `//#check-suppressions` turbo task under `bun run verify`. Do not write them.

- `|| true` — never swallow errors silently
- `2>/dev/null` — never hide stderr
- `|| bun install` (after `--frozen-lockfile`) — never bypass lockfile enforcement
- `|| echo` — never convert errors to messages
- `x-access-token` in URLs — use `GIT_ASKPASS` for git authentication
- Writing tokens to files (`.npmrc`, etc.) — pass tokens via env vars or `--token` flags
- `git add -A` or `git add .` — always stage specific files by path
- `--no-exit-code` — never bypass quality gate exit codes

If a command legitimately needs error handling, handle the specific error explicitly (e.g., check existence before creating, parse exit codes) rather than blanket-suppressing all failures.

## Commands

```bash
# Local iteration: run only the package tasks relevant to the change
bunx turbo run <task> --filter=<pkg>   # e.g. bunx turbo run typecheck --filter=birmel

# Local commit safety: staged files only (Prettier, Gitleaks, and cheap guards)
bunx lefthook run pre-commit

# Linting and autofix (per-package)
cd packages/<name> && bunx eslint . --fix

# Exhaustive whole-repo verification is the Buildkite gate. Run locally only
# when explicitly reproducing a CI failure or changing the verification system.
bun run verify

# CI runs on Buildkite (NOT GitHub Actions) via the static .buildkite/pipeline.yml
# Check CI status via Buildkite CLI or web UI, never `gh run`

# Foreground OpenRouter/AI SDK controller for the complete open PR fleet
# (spawns a live dashboard with question answering only; --no-ui to suppress)
bun run pr:fleet --model <catalog-model-id>

# Open the live/historical dashboard standalone (newest run, or --run <id|dir>)
bun run pr:fleet:watch

# Inspect a captured run (accepts a run ID or run-directory path)
bun run pr:fleet:inspect --run <run-id-or-directory>

# Deterministically verify and replay a captured run without model or network access
bun run pr:fleet:replay --run <run-id-or-directory>
```

### Fixed-corpus CI I/O candidate builds

`CI_IO_FIXED_CORPUS=true` is an operator-only mode for producing a comparable
CI I/O acceptance candidate on the current `main` commit. It forces the
playwright, resume, Docker E2E, images, and OpenTofu selectors; the image lane
builds and pushes every known image target, and the OpenTofu lanes perform real
applies. Unrelated selectors keep their normal change-based behavior.

After confirming the SHA is still current `main`, create the build with:

```bash
bk build create \
  --pipeline sjerred/monorepo \
  --branch main \
  --commit <current-main-sha> \
  --env CI_IO_FIXED_CORPUS=true \
  --yes
```

The value must be exactly `true`, and `BUILDKITE_BRANCH` must be `main`;
invalid, unset-branch, and non-main requests fail before the pipeline runs.
Treat this as a production-mutating build, not a read-only benchmark.

### Release refinement providers

The main-only `release-please` lane runs `scripts/release.ts`. Its CHANGELOG
refiner uses Claude first and falls back to Codex only when Claude returns a
validated usage-quota error. Both `CLAUDE_CODE_OAUTH_TOKEN` and
`CODEX_ACCESS_TOKEN` are required; unknown provider failures and fallback
failures remain hard CI failures. Claude Agent SDK and Codex SDK are pinned
production dependencies of `@shepherdjerred/root-scripts`, so the lane's
filtered install provides both native SDK runtimes without globally installed
`claude` or `codex` commands. Keep the provider-neutral procedure in
`scripts/prompts/refine-release-please.md`.

## GitHub CLI in Codex

`gh` works from Codex, but GitHub network access is sandboxed. Do not conclude that
`gh` is broken just because the first attempt says it cannot connect to
`api.github.com` or cannot resolve `github.com`.

- For GitHub reads (`gh status`, `gh repo view/list`, `gh pr view/list/diff/checks`),
  retry with Codex network escalation when the sandbox blocks the first attempt.
- For publishing or mutating GitHub state, check `gh auth status` early and separate
  auth failures from sandbox/network failures.
- For GitHub writes (`gh pr comment`, `gh issue create`, `gh pr create`,
  `gh pr review`, `gh pr merge`), require an explicit target and payload from the
  user or task, then run with Codex escalation.
- In Codex tool calls, escalation means rerunning `exec_command` with
  `sandbox_permissions: "require_escalated"` and a narrow `prefix_rule` such as
  `["gh", "pr", "view"]` or `["gh", "pr", "comment"]`.
- CI for this monorepo is Buildkite, not GitHub Actions. Do not use `gh run` as the
  CI source of truth; use Buildkite tooling or the relevant PR/status surface.
- If a PR or push flow fails, report the exact layer: local git ref permission,
  GitHub auth, sandboxed network access, or remote rejection.
- Feature PRs are created and updated with **git-spice** (`git-spice branch/stack
submit`), as stacks — not `gh pr create`. See the `git-spice-helper` skill. `gh`
  stays for PR reviews/comments/merge/queries and for automated single-PR bot flows
  (Temporal, release automation), whose clones have no local git-spice stack state.

## Development Setup

Three commands after cloning or pulling changes that touch dependencies or schemas:

```bash
mise install                 # install pinned toolchain (bun, node, tofu, …)
bun install --frozen-lockfile   # one workspace-wide install (isolated linker)
bunx turbo run generate      # codegen: Prisma clients, etc. (cached — near-instant when unchanged)
bunx lefthook install        # arm git hooks (once per clone — nothing auto-runs it)
```

There is no `scripts/setup.ts` and no per-package install: the repo is ONE bun
workspace with the isolated linker, so a single root `bun install` covers every
package and internal `workspace:*` deps resolve via live symlinks (no shared-artifact
copy step). The `generate` turbo task handles code generation; helm value types are
**not** regenerated here — the committed types in
`packages/homelab/src/cdk8s/generated/helm` are the source of truth. Regenerate them
when bumping a chart in `versions.ts` (`cd packages/homelab/src/cdk8s && bun run
generate-helm-types`); the `helm-types-drift-check` Buildkite step fails any PR that
changes a generator input without regenerating. Renovate chart-bump PRs will sit red
on that step until someone pushes the regen commit — that is by design (hosted
Renovate cannot run the generator).

Optional tools (warned if missing): helm, swift, swiftlint, swiftformat, typeshare, go, golangci-lint, mvn, gitleaks, shellcheck.

## Agent Conversation History and Work Logs

Agent conversations and work logs are local, private application data. They are not
repository artifacts and may contain credentials or other sensitive prompts. Read
these stores only as needed, prefer the client UI when available, and never copy raw
transcripts into the repository, commits, logs, or chat.

- Conductor user settings: `~/.conductor/settings.toml`.
- Conductor chats: `~/Library/Application Support/com.conductor.app/conductor.db`,
  especially the `sessions` and `session_messages` tables. Conductor documents this
  application-data directory as the local chat store: <https://www.conductor.build/docs/reference/privacy>.
- OpenCode bundled with Conductor: `~/Library/Application Support/com.conductor.app/opencode/opencode.db`.
- Claude Code transcripts: `~/.claude/projects/<encoded-project-path>/*.jsonl`,
  including `subagents/`. Supporting task and plan artifacts live under
  `~/.claude/tasks/` and `~/.claude/plans/`.
- Codex history: `~/.codex/thread_history_*.sqlite` contains structured thread
  history; `~/.codex/history.jsonl` contains prompt history; and
  `~/.codex/sqlite/codex-dev.db` contains the local thread catalog. PR-fleet session
  notes are under `~/.codex/controller_state/sessions/`.
- Cursor history and indexes: `~/Library/Application Support/Cursor/User/globalStorage/conversation-search.db`,
  related `state.vscdb` files under `globalStorage` and `workspaceStorage`, and
  workspace metadata under `~/.cursor/projects/`. Cursor's internal storage format
  is version-sensitive; the search database is an index, not necessarily the full
  transcript source.
- Standalone OpenCode: conversations are in `~/.local/share/opencode/opencode.db`,
  logs are in `~/.local/share/opencode/log/`, and configuration is in
  `~/.config/opencode/`. `~/.local/share/opencode/auth.json` contains credentials:
  never print, copy, commit, or paste its contents.

### Example History Queries

`toolkit history` provides the preferred local cross-client index. Install its
macOS LaunchAgent once; it polls the documented stores every 30 seconds and
keeps a private, rebuildable FTS5 index under `~/.toolkit/history/`. Search is
read-only and does not run live GitHub, deployment, Kubernetes, or cloud checks.

```bash
# Install and start background ingestion.
toolkit history daemon install

# “What did I work on last week?” (rolling seven-day window).
toolkit history recent --since 7d

# “Didn't I solve this before?”
toolkit history search "argocd prune" --since 90d --include-excerpts

# Inspect source coverage and ingestion errors.
toolkit history sources
toolkit history daemon status

# “What's the status of X?” — history finds prior context; verify current truth separately.
toolkit history search "X" --since 30d
toolkit deployed <service-or-commit>
toolkit pr health <PR_NUMBER>
```

Use `--source conductor|claude|codex|cursor|opencode-conductor|opencode-standalone`
to narrow a search and `--json` for agent-readable output. `--include-excerpts`
reopens source stores read-only for bounded excerpts; complete transcript bodies
are not copied into the index. The LaunchAgent, index, socket, state, and logs
are user-private. Never index or print standalone OpenCode's `auth.json`.

The commands below remain useful as a read-only fallback when the index has not
been installed or a client has changed its internal schema. The seven-day
examples use a rolling window; use explicit start and end dates when “last week”
means a calendar week.

To find recent work across the main stores:

```bash
# Conductor: recent session titles and workspaces.
sqlite3 -header -column "$HOME/Library/Application Support/com.conductor.app/conductor.db" \
  "SELECT datetime(s.updated_at, 'localtime') AS updated,
          COALESCE(w.workspace_name, w.directory_name) AS area,
          s.title, s.agent_type
     FROM sessions s
     LEFT JOIN workspaces w ON w.id = s.workspace_id
    WHERE s.updated_at >= datetime('now', '-7 days')
    ORDER BY s.updated_at DESC;"

# Claude Code: transcript files touched during the rolling window.
find "$HOME/.claude/projects" -type f -name '*.jsonl' -newermt '7 days ago' -print

# Codex: recent thread IDs and activity counts.
sqlite3 -header -column "$HOME/.codex/thread_history_1.sqlite" \
  "SELECT datetime(max(created_at_ms) / 1000, 'unixepoch', 'localtime') AS updated,
          thread_id, count(*) AS items
     FROM thread_items
    WHERE created_at_ms >= strftime('%s', 'now', '-7 days') * 1000
    GROUP BY thread_id
    ORDER BY updated DESC;"

# Cursor: recent searchable conversation titles (the DB is an index).
sqlite3 -header -column "$HOME/Library/Application Support/Cursor/User/globalStorage/conversation-search.db" \
  "SELECT title, datetime(updated_at / 1000, 'unixepoch', 'localtime') AS updated,
          source, scope, id
     FROM conversations
    WHERE updated_at >= strftime('%s', 'now', '-7 days') * 1000
    ORDER BY updated_at DESC;"

# Standalone OpenCode: recent sessions.
sqlite3 -header -column "$HOME/.local/share/opencode/opencode.db" \
  "SELECT datetime(time_updated / 1000, 'unixepoch', 'localtime') AS updated,
          title, directory, id
     FROM session
    WHERE time_updated >= strftime('%s', 'now', '-7 days') * 1000
    ORDER BY time_updated DESC;"
```

To answer “didn’t I solve this before?”, search file-backed transcripts first,
then search the SQLite stores for the same distinctive phrase. Keep the term
specific enough to avoid dumping unrelated private conversations:

```bash
worklog_term='argocd prune'
rg -n -i -C 2 "$worklog_term" \
  "$HOME/.claude/projects" \
  "$HOME/.codex/history.jsonl" \
  "$HOME/.codex/controller_state/sessions" \
  "$HOME/.local/share/opencode/log"

# Conductor transcript search; change only the bound parameter.
sqlite3 -header -column "$HOME/Library/Application Support/com.conductor.app/conductor.db" <<'SQL'
.parameter set :term 'argocd prune'
SELECT datetime(m.created_at, 'localtime') AS created,
       COALESCE(w.workspace_name, w.directory_name) AS area,
       s.title,
       substr(replace(replace(COALESCE(NULLIF(m.content, ''), m.full_message), char(10), ' '), char(13), ' '), 1, 240) AS excerpt
  FROM session_messages m
  JOIN sessions s ON s.id = m.session_id
  LEFT JOIN workspaces w ON w.id = s.workspace_id
 WHERE lower(COALESCE(m.content, '') || ' ' || COALESCE(m.full_message, ''))
       LIKE '%' || lower(:term) || '%'
 ORDER BY m.created_at DESC
 LIMIT 30;
SQL

# Codex structured item search; item_json may contain private prompt/tool data.
sqlite3 -header -column "$HOME/.codex/thread_history_1.sqlite" \
  "SELECT datetime(created_at_ms / 1000, 'unixepoch', 'localtime') AS created,
          thread_id, item_type, substr(item_json, 1, 240) AS excerpt
     FROM thread_items
    WHERE lower(item_json) LIKE '%argocd prune%'
    ORDER BY created_at_ms DESC
    LIMIT 30;"
```

To answer “what’s the status of X?”, use the matching history to identify the
workspace, PR, branch, or issue, then verify the current source, CI, deployment,
reachability, and runtime state separately. A transcript proves what was
discussed, not that the work is currently merged or deployed.

SQLite databases, caches, indexes, and sidecar/event-outbox files are
version-sensitive and should be inspected read-only. `.context/` is workspace
collaboration scratch space, not a canonical transcript archive. Do not treat
diagnostic logs or transient sidecar files as the primary conversation history.

## Verification

Local and CI verification deliberately have different scopes:

1. During implementation, run focused package tasks such as
   `bunx turbo run typecheck test lint --filter=<pkg>`.
2. The `pre-commit` hook checks staged files only: Gitleaks, Prettier, line
   endings, merge markers, environment-variable names, file size, and the
   staged-diff automation rules. It does not run the root Turbo graph.
3. Buildkite runs the exhaustive root `bun run verify` graph for every PR and
   for `main`: build, typecheck, test, lint, suppressions, markdownlint,
   Prettier, shellcheck, Knip, Gitleaks, ruff/pyright, Helm/Talos/1Password, and
   the remaining repository gates. The excluded site packages run in their
   dedicated Buildkite lanes, so the overall pipeline remains the
   full-repository backstop. **Exception:** `packages/macos-ai-subscription-tracker`
   has no Buildkite lane at all for `swift build`/`swift test`/coverage — only
   `lint:swift` (SwiftLint) runs in CI. The homelab's macOS Buildkite agent
   (`packages/homelab/mac-ci/`) is dormant, so
   `cd packages/macos-ai-subscription-tracker && bun run verify:macos` stays a
   local-only developer/release gate until that capacity is reactivated.

Run `bun run verify` locally only when explicitly reproducing CI or modifying
the verification machinery itself. There is no `pre-push` hook.

## PR Fleet Controller

`bun run pr:fleet --model <catalog-model-id> [--author <login>]` starts the
standalone AI SDK controller in the foreground. `OPENROUTER_API_KEY` is
required. The optional author scope includes that login's drafts and is recorded
in the manifest and dashboard. One selected catalog model powers the
conversational master and every bounded worker.
Use `/status`, `/tick`, `/questions`, `/answer <request-id> <free-text>`,
`/help`, `/stop`, or free-text steering. The controller may repair and publish
PR branches but may never merge, close, or approve them. Its exact model tool
boundary is documented in `packages/pr-fleet-controller/README.md`. Every run
writes a private local bundle; use
`bun run pr:fleet:inspect --run <run-id-or-directory>` for a
body-masked view and `bun run pr:fleet:replay --run <run-id-or-directory>` for
deterministic offline integrity and lifecycle verification. These commands
collect and inspect evidence; they do not run evals.

By default `pr:fleet` also builds and spawns a **narrowly controlled live web dashboard**
(the `@shepherdjerred/pr-fleet-web` package) that streams the run bundle over SSE
on loopback — a fleet overview plus a per-PR transcript including model reasoning.
Its only mutation is answering an active, head-bound operator question inside
that PR's detail view; it has no general pause, priority, steering, merge, or
publication controls. Standalone and historical dashboards remain read-only.
The live dashboard is torn down on shutdown; suppress it with `--no-ui`, fix the
port with `--ui-port`, or skip the browser with `--no-open`. Reasoning is
written live to the authoritative, redacted, digest-verified `spans.jsonl`
artifact in schema-v2 bundles. Historical v1 database bundles remain
inspectable and replayable. Open the
dashboard for any run (live or finished) with `bun run pr:fleet:watch [--run
<id|dir>]`.

Feature PRs are created and updated with `git-spice` as stacks; a single PR is a stack of one. Load the `git-spice-helper` skill before a branch or PR operation, use `git-spice` explicitly in scripts, and do not hand-roll a stack rebase or use bare `gh pr create` for feature work.

## Package Notes

Each package has its own AGENTS.md with specific instructions:

- `packages/birmel/AGENTS.md` - explicit agent runtime, Discord bot config
- `packages/homelab/AGENTS.md` - K8s, cdk8s, OpenTofu infrastructure
- `packages/scout-for-lol/AGENTS.md` - Match analysis pipeline
- `packages/resume/AGENTS.md` - Resume site
- `packages/toolkit/AGENTS.md` - CLI developer tools (pr, pd, bugsink, grafana)
- `packages/tasks-for-obsidian/AGENTS.md` - React Native task app, including native capture/detail, saved views, and bulk task organization
- `packages/tasknotes-macos/AGENTS.md` - Native macOS app (Swift posture, macOS-only tasks)
- `packages/docs/wiki/` - human-first public systems wiki

### TaskNotes shared core

`tasknotes-core` is the Rust core the macOS app runs on, and which iOS and a possible Windows
client are meant to share. Three rules matter more than the rest:

- **`crates/tasknotes-core` is pure and sans-I/O** — no clock, no filesystem, no network. HTTP and
  storage arrive as host-implemented traits. `crates/tasknotes-core-ffi` holds the UniFFI
  scaffolding and nothing else.
- **`bindings/` is committed on purpose.** UniFFI `Record` field order is the ABI, and reordering
  two same-typed fields leaves every API checksum _and_ the C header byte-identical — so
  `cargo xtask check-bindings` (a plain `git diff`) is the **only** mechanical guard against that
  silent data-corruption class. Never regenerate without committing the diff.
- **`@tasknotes/fixtures` is the oracle, not test data.** The same JSON scenarios and recurrence
  corpus are executed by both the TypeScript and Rust implementations; that is what keeps them from
  drifting. A fixture that disagrees with an implementation is a finding, never a file to edit.

## PR Media & Demo Artifacts — `public.sjer.red`

A reviewer should be able to **see** that a change works without checking out
the branch. Attach the **lightest artifact that proves the behavior** — most
PRs (pure logic, refactors, types, infra config, dep bumps) need nothing
beyond the diff; never attach media reflexively. A single visual state is a
screenshot, not a video.

| Change type                       | Artifact                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------- |
| UI tweak, single state            | Screenshot (before/after where it applies)                                       |
| UI flow / interaction / animation | Short GIF (renders inline) or short video (link)                                 |
| Brand-new feature                 | End-to-end demo — **one short video per scenario**, not one long tour            |
| CLI / TUI program                 | asciinema recording of a real terminal: `asciinema rec demo.cast -c "<command>"` |
| Web page / component              | Small static demo site uploaded as a directory (root `index.html` required)      |
| Metrics / logging / tracing       | Screenshot of Grafana/Loki showing the **new** data flowing end-to-end           |
| Anything else                     | Only when seeing it communicates faster than reading the diff                    |

Conventions: one artifact per scenario, a one-line caption saying what to
look at, before/after pairs when changing existing behavior.

`gh` cannot upload media into a PR/issue body (drag-drop uses a private,
session-only endpoint). Upload to the public artifact host and embed the
returned URLs:

```bash
# Creds come from your AWS profile (~/.aws); no op wrapper needed.
# Mix files, recordings, and demo-site directories in one call:
toolkit pr asset <PR_NUMBER> ./before.png ./flow.mp4 ./demo.cast ./demo-site --profile seaweedfs --markdown
```

- Uploads to the `public-sjer-red` SeaweedFS bucket under `pr/assets/<PR_NUMBER>/`
  and prints a `https://public.sjer.red/...` URL per argument (with
  `--markdown`, ready-to-paste type-appropriate markdown).
- **Embedding rules:** images/GIFs render inline via GitHub's image proxy
  (`![file](url)`); GitHub **never embeds external video** — videos become
  labeled links that play in a browser tab (served with a real video
  content type); `.cast` uploads get a generated self-contained HTML player
  page (`<name>.cast.html`) and the link points there; directories link to
  their `index.html`.
- Directories upload recursively to `pr/assets/<PR_NUMBER>/<dirname>/` and
  must contain a root `index.html` (dotfiles are skipped).
- Uses the standard AWS toolchain (`@aws-sdk/client-s3`, path-style): credentials,
  `endpoint_url`, and region come from `~/.aws/credentials` / `~/.aws/config`.
  Select the profile with `--profile <name>` or `AWS_PROFILE` (the `seaweedfs`
  profile points at `https://seaweedfs-s3.tailnet-1a49.ts.net`). SeaweedFS is
  tailnet-only — let the profile supply `endpoint_url` rather than passing
  `--endpoint-url` by hand, and do not use the retired `seaweedfs.sjer.red`
  name.
- Objects under `pr/assets/` expire after 365 days; the homelab must be up for
  the artifacts to load.
