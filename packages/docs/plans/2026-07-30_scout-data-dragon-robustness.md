---
id: scout-data-dragon-robustness
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Scout Data Dragon Temporal pipeline — robustness fixes

## Context

PagerDuty incident #6948 ("Scout Data Dragon Temporal update failed") paged on
2026-07-30 at 06:16 for a run that had already self-healed via Temporal's
built-in activity retry three minutes _before_ the page fired (a transient
`registry.npmjs.org` blip on an unrelated tarball during the workspace `bun
install`). Digging into why turned up four concrete, related robustness gaps
in the same pipeline, all confirmed by reading the live code:

1. **The alert pages on transient, already-retried attempts.** `recordRun()`
   writes `outcome="failed"` to the `scout_data_dragon_runs` Prometheus
   counter from _inside_ `updateDataDragon`'s per-attempt `catch` block
   (`packages/temporal/src/activities/data-dragon.ts:453-468`), so attempt 1's
   failure ticks the counter even though Temporal transparently retries the
   same activity and attempt 2 succeeds. Both `ScoutDataDragonUpdateFailed`
   and `ScoutDataDragonPrAutomationFailed`
   (`packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/temporal.ts:174-204`)
   query that counter with `max_over_time(...) > 0`, so a single self-healed
   attempt keeps the page condition true for the rest of the 24h window. The
   established repo convention for "record a workflow's _terminal_ outcome
   only" is `setOutcome()`
   (`packages/temporal/src/workflows/ha/util.ts:46-62`, backing
   `temporal_workflow_outcome_total`) — this fix applies the same terminal-only
   principle to Data Dragon's own counter.

2. **PR auto-merge failures are invisible.** The `gh pr merge --auto` call
   (`data-dragon.ts:402-423`) is wrapped in its own try/catch that only logs a
   `"warning"` — the error never reaches `recordRun`, so
   `ScoutDataDragonPrAutomationFailed`'s `reason=~"...|pr-merge-failed"` clause
   is unreachable dead code (confirmed: `failureReason()` in
   `data-dragon-util.ts:26-27` maps `"gh pr merge"` → `"pr-merge-failed"`, but
   that mapping only runs from the _outer_ catch, which the merge try/catch
   never lets an error reach). This is exactly what happened today: PR #1856's
   auto-merge setup failed, nobody was paged, and the PR sat unmerged.

3. **No duplicate-PR guard.** Every run generates a fresh UUID-suffixed branch
   (`branchName()`, `data-dragon-util.ts:7-9`), so if a prior PR for the same
   target version is still open (e.g. stuck on CI), the next scheduled run
   opens a second PR for the identical version bump. This is the mechanical
   cause behind the duplicate #1827/#1856 PRs found during the RCA.

4. **A single flaky `bun install` costs the whole ~13-minute activity.**
   `rootInstallWithoutHooks()` (`packages/temporal/src/activities/bot-clone.ts:44-52`)
   has no retry of its own; a registry blip there forces Temporal's full
   5-minute-backoff activity retry, redoing the clone + build + asset-download
   pipeline. `bot-clone.ts` is the shared helper every PR-creating activity
   uses (data-dragon, scout-season-refresh, readme-refresh, etc. — see
   `packages/temporal/CLAUDE.md`), so fixing retry here benefits all of them,
   not just Data Dragon.

Decisions already made with the user: add install-specific retry (item 4);
for duplicate PRs, skip creating a new one rather than auto-closing the old one
(no destructive PR automation). Out of scope: generalizing the
per-attempt/`activity_task_fail`-based false-positive pattern found in sibling
alerts (`ZfsMaintenanceFailed`, `GolinkSyncFailing*`, etc.) — those key off
Temporal's own built-in SDK metric and fixing them would mean adding
`setOutcome`-style terminal recording to unrelated workflows, a separate
initiative. Also out of scope: the nested second `bun install --force` that
`update-data-dragon.ts` runs internally inside `packages/scout-for-lol` — a
different package, and not implicated in today's incident (the failing
command in the logs was the first, non-`--force` install).

## Fix 1 — Only record `outcome="failed"` on the final retry attempt

`packages/temporal/src/activities/data-dragon-util.ts`: add a small pure
helper so the attempt-vs-final logic is unit-testable without mocking
Temporal's `Context`:

```ts
export function isFinalAttempt(attempt: number, maxAttempts: number): boolean {
  return attempt >= maxAttempts;
}
```

`packages/temporal/src/workflows/data-dragon.ts`: export the retry count as a
named constant instead of the inline literal `2`, so the workflow's retry
policy and the activity's final-attempt check can't drift apart:

```ts
export const UPDATE_DATA_DRAGON_MAX_ATTEMPTS = 2;
// ...
retry: {
  maximumAttempts: UPDATE_DATA_DRAGON_MAX_ATTEMPTS,
  ...
},
```

`packages/temporal/src/activities/data-dragon.ts` catch block (currently
lines 453-468): only call `recordRun({ outcome: "failed", ... })` when
`isFinalAttempt(Context.current().info.attempt, UPDATE_DATA_DRAGON_MAX_ATTEMPTS)`
is true; always keep the `jsonLog("error", ...)` call (include `attempt` and
`isFinalAttempt` in the logged fields) and always `throw error` so Temporal's
retry/failure machinery is unaffected. `Context` is already imported in this
file for heartbeating.

## Fix 2 — Make auto-merge failures alertable

`packages/temporal/src/activities/data-dragon-metrics.ts`: add a dedicated
counter and recorder, following the existing `metrics()`/`recordRun()`
pattern:

```ts
autoMergeFailures: metricMeter.createCounter(
  "scout_data_dragon_auto_merge_failures",
  "1",
  "Scout Data Dragon PR auto-merge setup failures",
),
// ...
export function recordAutoMergeFailure(mode: DataDragonUpdateMode): void {
  metrics().autoMergeFailures.add(1, { mode });
}
```

`packages/temporal/src/activities/data-dragon.ts`: in the auto-merge catch
block (lines 416-423), call `recordAutoMergeFailure(input.mode)` alongside the
existing `jsonLog("warning", ...)`.

`packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/temporal.ts`:
add a new rule right after `ScoutDataDragonPrAutomationFailed`:

```ts
{
  alert: "ScoutDataDragonAutoMergeFailed",
  annotations: {
    summary: "Scout Data Dragon PR auto-merge setup failed",
    description: escapePrometheusTemplate(
      "The Scout Data Dragon updater created a PR but failed to enable auto-merge {{ $value }} time(s) in the last 24 hours. The PR needs a manual merge — check open chore/scout-data-dragon-* PRs.",
    ),
  },
  expr: PrometheusRuleSpecGroupsRulesExpr.fromString(
    "increase(scout_data_dragon_auto_merge_failures[24h]) > 0",
  ),
  for: "15m",
  labels: { severity: "warning" },
},
```

Also drop the now-permanently-dead `pr-merge-failed` alternative from
`ScoutDataDragonPrAutomationFailed`'s regex (`temporal.ts:198`), since that
reason value can never be produced by the outer catch and the new alert above
covers the real signal.

## Fix 3 — Skip opening a new PR when one is already open for the target version

`packages/temporal/src/activities/data-dragon.ts`: add a new activity,
alongside `getDataDragonVersionState`/`recordDataDragonSkipped`:

```ts
async hasOpenDataDragonPr(latestVersion: string): Promise<boolean> {
  const { token } = await createGitHubAppInstallationToken();
  const title = `chore: update Scout Data Dragon to ${latestVersion}`;
  const output = await runCommand(
    ["gh", "pr", "list", "--repo", REPO_SLUG, "--state", "open",
     "--search", `${latestVersion} in:title`, "--json", "title"],
    { cwd: "/tmp", env: { GH_TOKEN: token } },
  );
  const prs = z.array(z.object({ title: z.string() })).parse(JSON.parse(output));
  return prs.some((pr) => pr.title === title);
},
```

The broad server-side `--search` term plus an exact client-side title
comparison sidesteps GitHub search's fuzzy tokenization of version strings
containing dots. Generalize `recordDataDragonSkipped`'s hardcoded
`reason: "version-current"` into a parameter (`input.reason`) so it can also
record `"pr-already-open"`.

`packages/temporal/src/workflows/data-dragon.ts`: proxy the new activity with
the same short-timeout/quick-retry config as `getDataDragonVersionState`, and
call it for both modes (weekly-refresh should not duplicate a still-open PR
either) before doing the expensive work:

```ts
const state = await getDataDragonVersionState();
if (mode === "version-check" && !state.updateRequired) {
  await recordDataDragonSkipped({ ...state, mode, reason: "version-current" });
  return undefined;
}
if (await hasOpenDataDragonPr(state.latestVersion)) {
  await recordDataDragonSkipped({ ...state, mode, reason: "pr-already-open" });
  return undefined;
}
return await updateDataDragon({ ...state, mode, lanePriors: input.lanePriors });
```

No auto-closing of stale PRs — a human still owns getting the existing PR
merged or closed.

## Fix 4 — Retry transient `bun install` failures inside `bot-clone.ts`

`packages/temporal/src/activities/bot-clone.ts`: add a small local
transient-error classifier (mirrors `scripts/lib/transient.ts`'s
`TRANSIENT_ERROR_PATTERN` intentionally kept in sync by hand — that package
has no `exports` map and isn't set up as a cross-package library, so this
duplicates the minimal regex rather than reshaping `scripts`' package
boundary) and a retry wrapper around just the install call:

```ts
const TRANSIENT_INSTALL_ERROR_PATTERN =
  /\bHTTP(?:\/\d(?:\.\d)?)?\s+5\d\d\b|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|connection reset|connection refused|temporary failure in name resolution|Fail extracting tarball|failed to download/i;

function isTransientInstallError(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.message}\n${error.stack ?? ""}`
      : String(error);
  return TRANSIENT_INSTALL_ERROR_PATTERN.test(text);
}

async function withInstallRetry(
  attempt: () => Promise<void>,
  maxAttempts = 3,
  delaySeconds = 5,
): Promise<void> {
  for (let i = 1; i <= maxAttempts; i += 1) {
    try {
      await attempt();
      return;
    } catch (error) {
      if (i === maxAttempts || !isTransientInstallError(error)) {
        throw error;
      }
      console.warn(
        `bun install attempt ${String(i)} failed transiently, retrying in ${String(delaySeconds)}s`,
      );
      await Bun.sleep(delaySeconds * 1000);
    }
  }
}
```

Wrap only the install call in `rootInstallWithoutHooks` (not the two build
steps — those are deterministic given a successful install, so a build
failure should stay a hard failure):

```ts
export async function rootInstallWithoutHooks(
  repoDir,
  commandRunner = runCommand,
) {
  await withInstallRetry(() =>
    commandRunner(["bun", "install", "--frozen-lockfile", "--ignore-scripts"], {
      cwd: repoDir,
      env: { BUN_INSTALL_CACHE_DIR: botCloneCacheDir(repoDir) },
    }),
  );
}
```

`Bun.sleep` is already used elsewhere in this package for in-activity delays
(`glitter-corpus-discord-client.ts:157`), so this matches convention. Total
worst-case added delay (~10s across 3 attempts) is well under the 60s
`heartbeatTimeout` every caller of this helper already sets.

## Remaining

- [x] Fix 1 — final-attempt-only failure metric (`data-dragon-util.ts`,
      `workflows/data-dragon.ts`, `activities/data-dragon.ts`)
- [x] Fix 2 — auto-merge failure metric + new alert rule + dead-regex cleanup
- [x] Fix 3 — duplicate-PR guard (`hasOpenDataDragonPr` + workflow wiring)
- [x] Fix 4 — transient `bun install` retry in `bot-clone.ts`
- [x] Tests: `data-dragon-util.test.ts` (new), extend `bot-clone.test.ts`,
      extend `temporal.test.ts` (`hasOpenDataDragonPr` covered indirectly via
      the extracted pure `hasMatchingPrTitle`/`dataDragonPrTitle` helpers
      instead of mocking the GitHub App token + `gh` subprocess, consistent
      with this file's existing convention of not unit-testing the I/O
      activities directly)
- [x] `bunx turbo run typecheck test lint --filter=@shepherdjerred/temporal`
      (781 pass, 0 fail)
- [x] `cd packages/homelab/src/cdk8s && bun run test` (277 pass, 0 fail;
      needed `bun run build` first to populate `dist/` for unrelated
      helm-render tests)
- [x] `bunx turbo run check:rehearsal --filter=@shepherdjerred/temporal`
      (passed — confirms the retry wrapper didn't change
      `rootInstallWithoutHooks`'s external contract)
- [ ] Open PR via git-spice

## Testing

- `packages/temporal/src/activities/data-dragon-util.test.ts` (new): unit
  tests for `isFinalAttempt` (below/at/above max attempts).
- `packages/temporal/src/activities/data-dragon.test.ts`: add a test for
  `hasOpenDataDragonPr` using a fake `runCommand`-style command runner
  returning canned `gh pr list --json title` output, covering exact-title
  match, near-miss (different version) non-match, and empty-list non-match.
- `packages/temporal/src/activities/bot-clone.test.ts`: extend with cases
  where the fake `commandRunner` throws a transient-pattern error N times
  then succeeds (expect eventual success, N+1 calls), and where it throws a
  non-transient error (expect immediate throw, exactly 1 call, no
  `Bun.sleep` wait). The existing "records exactly 3 calls" happy-path test
  should keep passing unchanged since the wrapper only calls once on success.
- `packages/homelab/src/cdk8s/src/resources/monitoring/monitoring/rules/temporal.test.ts`:
  add coverage for the new `ScoutDataDragonAutoMergeFailed` rule and update
  any existing assertion tied to `ScoutDataDragonPrAutomationFailed`'s regex
  now that `pr-merge-failed` is removed from it.
- Run focused checks: `bunx turbo run typecheck test lint --filter=@shepherdjerred/temporal`
  and `cd packages/homelab/src/cdk8s && bun run test` (per that workspace's
  own test script — see `packages/homelab/CLAUDE.md` on why bare `bun test`
  from `packages/homelab` gives spurious failures).
- `bunx turbo run check:rehearsal --filter=@shepherdjerred/temporal` exercises
  the shared `bot-clone.ts` helpers against a real tree — run it to confirm
  the retry wrapper didn't change `rootInstallWithoutHooks`'s external
  contract.
- No live end-to-end run of the actual Temporal schedule is practical from
  here (it needs real GitHub App creds + the cluster); the unit/rehearsal
  coverage above plus a code read of the final diff is the verification
  ceiling for this change.

## Session Log — 2026-07-30

### Done

- Implemented all four fixes exactly as planned:
  - Fix 1: `isFinalAttempt()` + `UPDATE_DATA_DRAGON_MAX_ATTEMPTS` in
    `packages/temporal/src/activities/data-dragon-util.ts`; the workflow
    (`workflows/data-dragon.ts`) imports the constant for its retry policy;
    the activity's catch block (`activities/data-dragon.ts`) now gates
    `recordRun({outcome:"failed"})` on `isFinalAttempt`.
  - Fix 2: `scout_data_dragon_auto_merge_failures` counter +
    `recordAutoMergeFailure()` in `data-dragon-metrics.ts`, wired into the
    auto-merge catch block; new `ScoutDataDragonAutoMergeFailed` Prometheus
    rule in `packages/homelab/.../rules/temporal.ts`; dropped the dead
    `pr-merge-failed` alternative from `ScoutDataDragonPrAutomationFailed`.
  - Fix 3: `hasOpenDataDragonPr` activity + `dataDragonPrTitle`/
    `hasMatchingPrTitle` shared helpers in `data-dragon-util.ts` (both the
    dedup check and the actual PR-creation title now go through the same
    helper, so they can't drift); wired into the workflow ahead of
    `updateDataDragon` for both modes.
  - Fix 4: `isTransientInstallError` + `withInstallRetry` in
    `packages/temporal/src/activities/bot-clone.ts`, wrapping only the
    `bun install` call inside `rootInstallWithoutHooks` (not the two build
    steps).
- Tests: new `data-dragon-util.test.ts` (`isFinalAttempt`,
  `hasMatchingPrTitle`); extended `bot-clone.test.ts`
  (`isTransientInstallError`, `withInstallRetry` retry/non-retry/exhaustion
  cases — exported `withInstallRetry` with an overridable `delaySeconds` so
  tests don't sleep for real); extended `temporal.test.ts` (new alert rule +
  dead-regex-removal assertions).
- Verification: `bunx turbo run typecheck test lint --filter=@shepherdjerred/temporal`
  (781 pass, 0 fail, only pre-existing jscpd warnings); `cd
packages/homelab/src/cdk8s && bun run build && bun run test` (277 pass, 0
  fail); `bunx turbo run check:rehearsal --filter=@shepherdjerred/temporal`
  (passed). `bunx prettier --write` applied to reformat the new/edited files.
- No deviations from the approved plan — all four fixes landed as designed.

### Remaining

- Open the PR via git-spice and get it through CI/review.
- Nothing else outstanding from this session; no follow-up todo filed.

### Caveats

- `hasOpenDataDragonPr` itself (the I/O activity: GitHub App token mint +
  `gh pr list` shell-out) is not directly unit-tested — consistent with this
  file's existing convention (`getDataDragonVersionState` isn't either). Its
  interesting logic (exact-title matching against GitHub's fuzzy search
  results) is fully covered via the extracted pure `hasMatchingPrTitle`/
  `dataDragonPrTitle` helpers instead.
- No live Temporal/GitHub end-to-end run was performed — verification ceiling
  is unit tests + the bot-clone rehearsal script + a full code read. The next
  real Data Dragon version bump (or a manual schedule trigger) is the first
  live exercise of Fix 3's dedup check and Fix 4's retry path.
