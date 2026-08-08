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
├── docs/                       # AI working docs plus the nested human-first wiki
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
├── tasknotes-server/           # TaskNotes sync server
├── tasknotes-types/            # TaskNotes shared types
├── tasks-for-obsidian/         # React Native task app
├── temporal/                   # Temporal workflows, schedules, and agent-task scheduler
├── terraform-provider-asuswrt/ # Terraform provider for AsusWRT
├── toolkit/                    # CLI developer tools (pr, pd, bugsink, grafana)
├── trmnl-dashboard/            # TRMNL e-ink dashboard
├── webring/                    # Webring component (npm)
scripts/                        # Repo automation (setup-free): checks, deploys, release, hooks
.buildkite/pipeline.yml         # Static Buildkite CI pipeline (no generator)
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

## Code Review Rules

These rules steer the automated PR code-review provider (Codex by default; the
gate is provider-neutral — see `@shepherdjerred/code-review` and the `review-gate`
Buildkite step). They apply repo-wide; per-package `AGENTS.md` files add more.

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
- **Process invariants.** `TODO(todo:<id>)` markers need a matching
  `packages/docs/todos/<id>.md`; `temporal-agent-task` blocks must match the schema;
  prefer Bun-runtime APIs; ensure Prisma teardown in tests; follow the K8s/cdk8s
  and git-spice conventions.
- **Severity discipline.** Only flag genuine issues (P0–P2); skip nits and anything
  a linter would catch. A clean diff should get a clean review.

## Documentation Discipline

Do not create per-session journals or append session summaries to repository
documents. Ordinary Q&A, investigations, and small fixes need no documentation
artifact solely because an agent worked on them.

Create a **plan** (`packages/docs/plans/<YYYY-MM-DD>_<kebab-slug>.md`) only when
the design itself is durable: plan mode was used, the work has substantive
design choices, or future implementation needs a decision-complete handoff.
Architecture, decisions, guides, and TODOs remain appropriate when the content
belongs to those durable categories independently of the current session.

### Plans and durable context

- The primary artifact for a code-changing session is a pull request. Create a
  draft PR from the feature branch as soon as it contains a coherent first commit,
  and promote it to ready for review only after verification is complete.
- Keep every agent-created write, including an implementation plan, in the
  active checkout. Do not leave duplicate or partial work in another checkout.
- When plan mode supplies an approved plan, mirror it into `packages/docs/plans/`
  using the dated naming convention before implementation.
- Record unfinished work in the relevant durable document, the PR description,
  or the final response; do not create a journal just for handoff.
- Plans use canonical YAML frontmatter with `id`, `type`, `status`, and `board`,
  remain raw Markdown, and are not individually indexed.
- When a plan reaches `status: complete` and its work ships, move it to
  `packages/docs/archive/completed/`.
- See `packages/docs/AGENTS.md` for the durable documentation taxonomy.

Repository lifecycle hooks are scoped to local CLI runtimes and must exit
immediately in hosted or web environments.

## TODO Documentation

`packages/docs/todos/` is for **general issue tracking** — deferred work, acceptance-testing gaps, post-merge verifications, and any thread that needs to outlive a single session. It is not limited to source-code markers; most todos will have no marker at all.

- Every source marker (`TODO(todo:<kebab-id>)`, `FIXME(todo:<kebab-id>)`, `XXX(todo:<kebab-id>)`) MUST have a matching `packages/docs/todos/<kebab-id>.md`. This direction is enforced.
- General issue todos may exist with no source marker. Use kebab-case ids; the filename (sans `.md`) is the id.
- TODO docs use the canonical docs frontmatter. Set `type: todo`, `board: true`, a workflow `status` (`planned`, `in-progress`, `awaiting-human`, or `complete`), `verification`, and `disposition`; use `origin` only when the referenced source is durable, and add `source_marker: true` only when a code marker exists.
- Active work uses unchecked tasks in `## Remaining`. Work ready for delayed signoff uses `status: awaiting-human` plus `## Human Verification`. Append steering notes and status audit entries under `## Comment Log`.
- When resolved, remove any matching source marker and archive the complete TODO to `packages/docs/archive/completed/` in the same commit.
- `bun run check-todos` enforces the complete docs model, including the source-marker → TODO invariant, frontmatter, semantic headings, workflow sections, IDs, and archival rules.

## Temporal Agent Follow-ups

When a doc captures a follow-up that should be checked later, schedule it explicitly with a `temporal-agent-task` block and the Temporal trigger script. Use report-only tasks by default; they may inspect current state and email results, but must not edit files, open PRs/issues, or mutate live systems.

```md
<!-- temporal-agent-task
{
  "title": "Recheck Birmel post-deploy metrics",
  "provider": "claude",
  "mode": "report-only",
  "runAt": "2026-05-31T09:00:00-07:00",
  "repo": { "fullName": "shepherdjerred/monorepo", "ref": "main" },
  "source": {
    "docPath": "packages/docs/guides/2026-04-25_birmel-remediation-followups.md"
  },
  "prompt": "Pull the metrics from the Post-deploy verification section. Email whether each check is green or still red, with links/evidence."
}
-->
```

For recurring checks, replace `runAt` with `cron` and include a stable `scheduleId`. Schedules are evaluated in `America/Los_Angeles`. To create/update the task locally as an operator:

```bash
cd packages/temporal
TEMPORAL_ADDRESS=localhost:7233 bun run scripts/schedule-agent-task.ts --from-doc ../../packages/docs/guides/<doc>.md
```

Do not expose general-purpose Temporal scheduling as a public ingress path. Public creation must go through the authenticated `/agent-tasks` HTTP API with `Authorization: Bearer $AGENT_TASK_API_TOKEN`. A narrowly scoped, separately authenticated webhook may start a fixed workflow when its route, input schema, workflow ID, and authorization token are dedicated to that automation and covered by equivalent tests.

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

# Foreground, provider-neutral Mastra controller for the complete open PR fleet
# (spawns a live dashboard with question answering only; --no-ui to suppress)
bun run pr:fleet --model <provider>/<model-id>

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
`OPENAI_API_KEY` are required; unknown provider failures and fallback failures
remain hard CI failures. Codex is a pinned production dependency of
`@shepherdjerred/root-scripts`, so the lane's filtered install provides the
binary without depending on a future CI-base image rollout. Keep the
provider-neutral procedure in `scripts/prompts/refine-release-please.md`.

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

## Verification

Local and CI verification deliberately have different scopes:

1. During implementation, run focused package tasks such as
   `bunx turbo run typecheck test lint --filter=<pkg>`.
2. The `pre-commit` hook checks staged files only: Gitleaks, Prettier, line
   endings, merge markers, environment-variable names, file size, and the
   staged-diff automation rules. It does not run the root Turbo graph.
3. Buildkite runs the exhaustive root `bun run verify` graph for every PR and
   for `main`: build, typecheck, test, lint, todos, suppressions, markdownlint,
   Prettier, shellcheck, Knip, Gitleaks, ruff/pyright, Helm/Talos/1Password, and
   the remaining repository gates. The excluded site packages run in their
   dedicated Buildkite lanes, so the overall pipeline remains the
   full-repository backstop.

Run `bun run verify` locally only when explicitly reproducing CI or modifying
the verification machinery itself. There is no `pre-push` hook.

## PR Fleet Controller

`bun run pr:fleet --model <provider>/<model-id>` starts the standalone Mastra
controller in the foreground. One selected API model powers the conversational
master and every bounded worker. Use `/status`, `/tick`, `/help`, `/stop`, or
free-text steering. The controller may repair and publish PR branches but may
never merge, close, or approve them. Its exact model tool boundary is documented
in `packages/pr-fleet-controller/README.md`. Every run writes a private local
bundle; use `bun run pr:fleet:inspect --run <run-id-or-directory>` for a
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
mirrored live to a best-effort `spans.jsonl` in the bundle because
`observability.duckdb` is exclusively locked while the run holds it. Open the
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
- `packages/tasks-for-obsidian/AGENTS.md` - React Native task app
- `packages/docs/` - AI working docs plus `wiki/`, the human-first explanation layer (see `monorepo-docs` skill)

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
  profile points at `https://seaweedfs.sjer.red`).
- Objects under `pr/assets/` expire after 365 days; the homelab must be up for
  the artifacts to load.
