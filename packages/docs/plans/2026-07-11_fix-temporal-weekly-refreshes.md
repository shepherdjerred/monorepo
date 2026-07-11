# Fix weekly Temporal workflow failures (scout-data-dragon, scout-season-refresh, readme-refresh)

## Status

Complete

## Context

Three Temporal schedules failed every week for 2–4 weeks (all `RETRY_STATE_MAXIMUM_ATTEMPTS_REACHED` — deterministic environment gaps in the worker's ephemeral `/tmp` clone, not flakes). Diagnosis: [2026-07-11_scout-temporal-workflow-failures.md](../logs/2026-07-11_scout-temporal-workflow-failures.md).

| Workflow                           | Failing since | Root cause                                                                                                                                                        |
| ---------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scout-data-dragon-weekly-refresh` | Jun 20        | `@shepherdjerred/llm-models` (`file:` dep, gitignored `dist/`) never built in the temp clone → snapshot-update `bun test` fails with `Cannot find module`         |
| `scout-season-refresh-weekly`      | Jun 15        | Root `bun install` (for changelog prettier) runs root `prepare` → `lefthook install` → bot's `git commit` runs the full dev pre-commit suite in the pod and fails |
| `readme-refresh-weekly`            | Jun 15        | `COG_TARGETS` still listed `practice/README.md` / `archive/README.md`, which moved to `sandbox/` → cog `FileNotFoundError`                                        |

Decisions (made with the user):

- **No hooks in bot clones** — ephemeral bot clones are not dev checkouts; the root install is done with `--ignore-scripts` so `lefthook install` never arms hooks. Buildkite CI on the opened PR stays the real gate. (Not `git commit --no-verify` — hooks are never installed, not bypassed.)
- **One themed PR** covering all three workflows plus prevention.

## Fixes

- `packages/temporal/src/activities/bot-clone.ts` (new) — shared bot-clone environment helpers: `rootInstallWithoutHooks` (root install with `--ignore-scripts`), `buildLlmModels`, `installScoutWorkspace` (build the `file:` producer, then install the consumer workspace). Mirrors `withBuiltLlmModels` (`.dagger/src/image.ts`) and setup.ts Phase 3.
- `data-dragon.ts` — `installScoutWorkspace(repoDir)` replaces the bare scout install.
- `scout-season-refresh.ts` — `prepareWorkdir` pre-installs the scout workspace (so Claude's `bun test src/seasons.test.ts` works first try and never improvises installs); the changelog-prettier root install is now `rootInstallWithoutHooks`.
- `readme-refresh.ts` — `COG_TARGETS` corrected to `sandbox/practice/README.md` / `sandbox/archive/README.md`; root install is now `rootInstallWithoutHooks`; PR-body text updated.

## Prevention: `temporal-schedule-rehearsal` CI step

"Will the weekly Temporal jobs still run after this merges?" answered at PR time:

- `packages/temporal/scripts/rehearse-bot-clone.ts` — drives the SAME `bot-clone.ts` helpers (never a copy) against a repo tree. Canaries: llm-models build/resolution + the exact snapshot test that failed; hook-free root install → no armed hooks → prettier byte-stability on the changelog → bot-style `git commit` with no lefthook; cog binary present + `COG_TARGETS` exist with `[[[cog` blocks. Expensive parts (asset downloads, Claude/Codex, full `cog -r`) deliberately not rehearsed — they never broke.
- `.dagger/src/image.ts` `temporalScheduleRehearsalHelper` + `temporal-schedule-rehearsal` `@func()` — builds the temporal-worker image (engine de-dups with the build step) and runs the script inside it against the mounted repo tree.
- `scripts/ci/src/steps/images.ts` — temporal-worker added to `SMOKE_TEST_FUNCTIONS` (new `SMOKE_REPO_TREE` variant passing `--repo-dir` at `$BUILDKITE_COMMIT`); replaces the plain `build-temporal-worker` step, push step auto-depends on it.

## Verification performed (2026-07-11, local)

1. **data-dragon end-to-end**: fresh shallow clone of main + fixed install sequence + full `bun run update-data-dragon 16.13.1` — completed including `📸 Updating snapshots... ✅ Snapshots updated` (the step that failed Jun 20–Jul 11). 3,496 assets downloaded.
2. **Hook-free commit path**: fresh clone — `rootInstallWithoutHooks` leaves zero hooks; prettier(+astro plugin) byte-stable on the changelog; bot-style commit of a scout file succeeds with no lefthook. Negative control: a plain root install arms `pre-commit`/`commit-msg` (reproduces the bug).
3. **cog**: `uvx --from cogapp==3.6.0 cog -r <fixed targets>` exits 0 on a blobless clone of main (regenerated tables + 4 new Codex `_summary.md`s; prettier pass clean).
4. **Rehearsal script**: full pass against a pristine no-`.git` tree (CI shape); negative control — removing `sandbox/practice/README.md` fails with the intended message. `dagger functions` lists `temporal-schedule-rehearsal`; pipeline generator renders `smoke-temporal-worker` calling it with `--repo-dir`, and `push-temporal-worker` depends on it.
5. `bun run typecheck` / `bun run test` (603 pass) / eslint clean in packages/temporal; `.dagger` + `scripts/ci` typecheck and lint clean.

## Follow-ups

- `packages/docs/todos/scout-twisted-missing-champions.md` — twisted doesn't recognize champions Locke (805) / Zaahen (904); bump twisted in scout.
- The rehearsal only runs when CI builds the temporal-worker image (temporal/infra changes). A repo restructure that moves cog targets without touching temporal (how readme-refresh broke) still lands silently until the next temporal build or weekly run — accepted; the alerting gap (failures went unnoticed for a month) is a separate thread.
