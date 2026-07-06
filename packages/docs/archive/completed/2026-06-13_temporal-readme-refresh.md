# Plan: Move README auto-update into a weekly Temporal workflow

## Status

Complete — shipped in PR #1164 (Buildkite-UI schedule removal tracked in todos).

## Context

README project listings are regenerated today by a **Buildkite scheduled build** running
`.buildkite/scripts/update-readmes.sh`. That script runs `cog -r README.md practice/README.md archive/README.md`
(cogapp expands embedded Python blocks that summarize each package, caching results in committed `_summary.md`
files and calling the Codex CLI only for packages missing one), then mints a GitHub App token, commits to a
rolling `auto/update-readmes` branch, force-pushes, and opens/updates a PR.

The user wants this **moved off Buildkite into a weekly Temporal workflow** that opens a PR using the same
pattern Scout-for-LoL workflows already use (clone → regenerate → `openSeasonRefreshPr`). The monorepo already
has a near-identical precedent: `helm-types-weekly-refresh` (weekly codegen-drift → PR). This is the template.

Notably, `.dagger/src/image.ts:867` already says the temporal-worker image ships `gh` + `claude` for "the
docs-groom workflow" — that workflow was anticipated but never built. This is it.

## Approach

Reuse the existing cog mechanism verbatim (single source of truth, still runnable locally) — only the **trigger**
moves from a Buildkite cron to a Temporal weekly schedule. Mirror `helm-types-refresh` exactly. The one
infra gap: `cog` (Python/cogapp) isn't in the worker image, so add it.

## Changes

| #   | File                                                    | Change                                                                         |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1   | `packages/temporal/src/activities/readme-refresh.ts`    | **NEW** activity — clone, `cog -r`, stage, open PR                             |
| 2   | `packages/temporal/src/workflows/readme-refresh.ts`     | **NEW** workflow wrapper (proxyActivities + types only)                        |
| 3   | `packages/temporal/src/workflows/index.ts`              | Register `runReadmeRefresh` export                                             |
| 4   | `packages/temporal/src/activities/index.ts`             | Spread `readmeRefreshActivities`                                               |
| 5   | `packages/temporal/src/schedules/register-schedules.ts` | Add `readme-refresh-weekly` schedule                                           |
| 6   | `.dagger/src/constants.ts`                              | Add `COGAPP_VERSION` (renovate-pinned)                                         |
| 7   | `.dagger/src/image.ts`                                  | Add `withCogapp` helper; wire into temporal-worker image; fix line-867 comment |
| 8   | `.buildkite/scripts/update-readmes.sh`                  | **DELETE**                                                                     |
| 9   | Docs                                                    | Update temporal AGENTS.md/CLAUDE.md + README "Updating READMEs" section        |

### 1. Activity — `activities/readme-refresh.ts`

Copy `activities/helm-types-refresh.ts` structure (same imports: `createGitHubAppInstallationToken`,
`runCommand` from `data-dragon-shell.ts`, `changedFilesInPaths` + `openSeasonRefreshPr` from
`scout-season-refresh-git.ts`; same 10s heartbeat; same `try/finally` tmpdir cleanup). Differences:

- **Full history clone**, NOT `--depth 1`: use `simpleGit().clone(REPO_URL, repoDir, ["--branch","main","--single-branch","--filter=blob:none"])`. The cog blocks sort packages by first-commit date via `git log --diff-filter=A --reverse` — a shallow clone breaks that ordering.
- **Regenerate**: `runCommand(["cog","-r","README.md","practice/README.md","archive/README.md"], { cwd: repoDir })`. No `bun install` needed (cog is a system binary; Codex auth comes from the pod's `OPENAI_API_KEY`, already set per temporal AGENTS.md).
- **Stage set**: cog only ever touches the 3 READMEs + writes new `packages|practice|archive/*/_summary.md`. After `cog -r`, run `git status --porcelain` (whole tree) and collect paths that are exactly one of the 3 READMEs OR end in `/_summary.md`. If empty → return `{ outcome: "no-diff" }`. Pass that explicit path list as `files` to `openSeasonRefreshPr` (it does `git add -- <files>`; explicit paths avoid shell-glob issues since `runCommand` uses `Bun.spawn`, no shell). Fail-fast: if `git status` shows unexpected non-README/non-summary changes, do not stage them.
- **Branch / title** (scout pattern — fresh branch per run): `branch = chore/readme-refresh-${id.slice(0,8)}`, commit/title `docs(root): refresh README project listings` (verify `docs`+`root` pass `scripts/validate-commit-msg.ts`; hooks don't run in the fresh clone but keep the message valid). Body lists changed files like helm-types does.
- Result type `ReadmeRefreshResult` = `{ changedFiles, branchName, commitHash, prUrl, outcome: "pr-created" | "no-diff" }`.

### 2. Workflow — `workflows/readme-refresh.ts`

Verbatim shape of `workflows/helm-types-refresh.ts`: `proxyActivities<ReadmeRefreshActivities>` (startToClose
20 min, heartbeat 60s, 2 attempts), `export async function runReadmeRefresh(): Promise<ReadmeRefreshResult>`.
Imports **types only** from the activity so the `bundle.test.ts` webpack smoke test stays green.

### 3 & 4. Registries

- `workflows/index.ts`: import `runReadmeRefresh as _runReadmeRefresh` + `ReadmeRefreshResult` type; export wrapper `runReadmeRefresh()` (mirror lines 27-28, 141-143).
- `activities/index.ts`: import + spread `readmeRefreshActivities` (mirror line 20, 42).

### 5. Schedule — `register-schedules.ts`

Add to `SCHEDULES` (mirror the `helm-types-weekly-refresh` entry):

```ts
{
  id: "readme-refresh-weekly",
  workflowType: "runReadmeRefresh",
  args: [],
  cronExpression: "0 8 * * 1",        // Mon 08:00 PT — staggered after helm-types (06:00) & season-refresh (07:00)
  taskQueue: TASK_QUEUES.DEFAULT,
  overlap: ScheduleOverlapPolicy.SKIP,
  workflowExecutionTimeout: "30 minutes",
  memo: "Weekly README project-listing regeneration via cog (opens a PR if listings drifted)",
},
```

### 6 & 7. Worker image gets `cog`

- `constants.ts`: `// renovate: datasource=pypi depName=cogapp` + `export const COGAPP_VERSION = "3.6.0";` (move the pin out of the deleted shell script).
- `image.ts`: new `withCogapp(container)` — `apt-get install -y -qq --no-install-recommends python3 python3-pip ca-certificates`, clean apt lists, `pip3 install --no-cache-dir --break-system-packages cogapp==${COGAPP_VERSION}`, smoke `cog --version`. Installs `cog` to `/usr/local/bin` (world-readable for UID 1000). Wire into `buildTemporalWorkerImageHelper` alongside `withHelm(...)` (line ~879). Update the line-867 comment to name `readme-refresh-weekly` instead of the nonexistent "docs-groom workflow". (Codex is already global via `withEditorClis`; the cog block's `bunx @openai/codex` resolves from the bun cache — only hit for brand-new packages with no committed `_summary.md`.)

### 8. Delete Buildkite script

`git rm .buildkite/scripts/update-readmes.sh`. Nothing in-repo invokes it (confirmed: only self-reference).

## Behavioral changes to flag

- **Rolling PR → fresh PR per run.** BK force-pushed one persistent `auto/update-readmes` branch; the scout pattern opens a new `chore/readme-refresh-<sha>` PR each week when there's drift. This matches what was requested. (If a single rolling PR is preferred, use a stable branch instead — call out at review.)
- **Manual, out-of-repo step:** the Buildkite **scheduled build** that runs this script is configured in the Buildkite UI (not IaC — no `pipeline_schedule` resource exists). Deleting the script stops nothing on its own; the BK schedule must be disabled/deleted in the Buildkite UI. → file a `packages/docs/todos/` item.
- No new secrets: worker pod already has `OPENAI_API_KEY` + `GITHUB_APP_{ID,INSTALLATION_ID,PRIVATE_KEY}`.

## Verification

1. **Cog unchanged, still works locally:** `uvx --from cogapp cog -r README.md practice/README.md archive/README.md` → `git diff` should be empty (or only legit drift). No code in the READMEs themselves changes.
2. **Temporal package:** `cd packages/temporal && bun run typecheck && bun test` — the `workflows/bundle.test.ts` smoke test must pass (proves the new workflow file imports no side-effecting activity code).
3. **Lint:** `cd packages/temporal && bunx eslint . --fix`; `cd .dagger && bunx eslint . --fix`.
4. **Image builds with cog:** `dagger call` the temporal-worker build; the `cog --version` / `codex --version` `withExec` smoke checks fail the build if the tools are missing.
5. **End-to-end after deploy:** manually trigger once via Temporal UI / `temporal workflow start --type runReadmeRefresh --task-queue default` and confirm it either opens a PR or returns `no-diff`. Inspect the PR diff to confirm only READMEs + `_summary.md` changed.
6. **Commit-msg validity:** `echo "docs(root): refresh README project listings" | bun scripts/validate-commit-msg.ts` (adjust scope if the allowlist rejects it).

## Out of scope

- Rewriting the cog Python logic in TypeScript (keeps cog as single source of truth + locally runnable; rejected to avoid drift).
- Changing what the READMEs contain or how summaries are generated.
  </content>
  </invoke>

## Session Log — 2026-06-13

### Done

- New activity `packages/temporal/src/activities/readme-refresh.ts` — clones the monorepo (full blobless history), runs `cog -r README.md practice/README.md archive/README.md`, stages only the 3 READMEs + changed `_summary.md`, opens a PR via `openSeasonRefreshPr`. Mirrors `helm-types-refresh`.
- New workflow `packages/temporal/src/workflows/readme-refresh.ts` (`runReadmeRefresh`; types-only import so the bundle smoke test stays green).
- Registered in `workflows/index.ts` + `activities/index.ts`; added `readme-refresh-weekly` schedule (`0 8 * * 1` PT) to `schedules/register-schedules.ts`; classified `runReadmeRefresh` in `register-schedules.test.ts`'s `WORKFLOWS_WITHOUT_LONG_SLEEPS`.
- Worker image gets `cog`: new `withCogapp` helper in `.dagger/src/image.ts` (python3 + `pip3 install cogapp`), wired into `buildTemporalWorkerImageHelper`; `COGAPP_VERSION` (renovate-pinned) added to `.dagger/src/constants.ts`. Corrected stale "docs-groom workflow" comments.
- Deleted `.buildkite/scripts/update-readmes.sh`.
- Docs: README "Updating READMEs" note, `packages/temporal/AGENTS.md` "Weekly README refresh" section, and `packages/docs/todos/disable-buildkite-readme-schedule.md`.
- Verified: temporal typecheck ✓, workflow bundle smoke test ✓, schedule test 35/35 ✓, temporal eslint ✓, `.dagger` typecheck ✓ (after `dagger develop`), check-dagger-hygiene ✓, check-todos ✓, check-suppressions ✓, commit-msg ✓.

### Remaining

- **Manual (out-of-repo):** disable/delete the Buildkite scheduled build that ran `update-readmes.sh` in the Buildkite UI — no IaC resource exists for it. Tracked in `packages/docs/todos/disable-buildkite-readme-schedule.md`.
- After merge + worker deploy: confirm `readme-refresh-weekly` fires once and opens (or no-diff's) a PR.

### Caveats

- **Behavioral change:** the old BK job force-pushed one rolling `auto/update-readmes` branch; this opens a fresh `chore/readme-refresh-<sha>` PR each week on drift (the scout/helm pattern).
- The cog blocks call `bunx @openai/codex` only for brand-new packages lacking a committed `_summary.md`; needs the pod's `OPENAI_API_KEY` (already present) + network. Steady-state runs make no Codex calls.
- `git status --porcelain` parsing deliberately avoids the leading `.trim()` bug in `changedFilesInPaths` (which mangles status lines whose first column is a space, i.e. unstaged-only changes) since this job stages scattered exact paths, not a directory.

## Testing & generation-quality fixes — 2026-06-13 (cont.)

Ran the actual generation locally (blobless clone + `cog -r`) before relying on the workflow. This validated the infra **and surfaced three real problems the move alone wouldn't have caught**:

- **`cog --version` doesn't exist** in cogapp 3.6.0 (`option --version not recognized`) → the `withCogapp` image smoke check would have failed the temporal-worker build. Fixed to `cog --help` (commit `8af0d035c`).
- **codex contaminated ~8/21 summaries.** `codex exec` runs in the repo root, reads `AGENTS.md`, obeys "every session must produce a session log," and dumps `**Done**/**Remaining**/**Caveats**` meta into the summary (e.g. _"Workspace is read-only, so no session log was added"_). Fixed by passing `-c project_doc_max_bytes=0` in all three README cog blocks (validated: trmnl-dashboard summary went CONTAMINATED→CLEAN).
- **cog output fails the prettier gate** (e.g. a missing blank line after `]]]-->`), so auto-PRs would fail CI. The activity now runs `bun install --frozen-lockfile` + `bunx prettier --write` on the regenerated files before opening the PR (mirrors helm-types). markdownlint only checks the root `README.md` (`archive/**`, `practice/**`, `**/_summary.md` are ignored); clean single-paragraph summaries don't trip MD032.

**Seeded 23 `_summary.md`** (commits `47e34f5f8` + `529c5a1b4`) so the first scheduled run is ~a no-op rather than a 21-call codex batch. All summaries spot-checked for accuracy: terraform-provider-asuswrt initially got temporal's summary (codex wandered) — regenerated correctly; cooklang-for-obsidian had a stale "Bazel" mention — regenerated clean.

### Convergence (not instant idempotency)

`cog` only ever **adds** a missing `_summary.md`, never removes one. Packages near the 170-char quality bar (e.g. `archive/tips`, `practice/langchain`) pass codex some runs and fail others, so the workflow is **convergent**: the first few weekly runs may open a small PR adding a borderline summary, then it settles. Six trivial dirs (`practice/Exercism`, `practice/hson`, `archive/devcontainers-features`, `archive/eng211-research-paper`, `archive/is-quarantine-over-yet`, `archive/siphon`) consistently fail the bar and render "_No description available._" — stable, left as-is. These trivial dirs also cost ~6 codex calls per run (cog retries the uncached ones); acceptable for a weekly job, but a future improvement could cache a sentinel so they're not retried.
