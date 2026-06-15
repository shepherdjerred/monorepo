# PR Merge-Conflict Check on Push to Main

## Status

In Progress — Phase 0 (de-risk) complete. Implementation not yet started.

## Context

Today nothing flags an open PR as "you've fallen behind / will conflict with main" until you click the PR. The request: **whenever main moves**, walk every open PR that targets main, compute the merge result ourselves with `git merge-tree`, and post a per-PR status check — **RED if there is a conflict, GREEN otherwise**.

Two ground rules (user-stated):

- **Do not trust GitHub's `mergeable` field.** Compute conflict status from a local 3-way merge so the answer is deterministic, instant, and doesn't depend on GitHub's lazy recomputation.
- **Push to main is the primary trigger.** PR pushes (`pull_request` synchronize/opened/reopened/edited) are a secondary trigger purely so a brand-new commit on a PR isn't left status-less — but the contract reviewers care about is "when main moves, every PR re-evaluates."

Picked **Temporal + GitHub webhooks**. Temporal already hosts every GitHub-touching automation (webhook receiver, App-token minting, retries, observability). The compute pattern already exists in `src/activities/data-dragon.ts` / `pokeemerald-wasm.ts` (clone monorepo → run git ops → call GitHub via App token).

## Triggers & runtime

| Trigger                                                                             | Scope                                   | Workflow ID                                                                                                        |
| ----------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `push` to `refs/heads/main` (**primary**)                                           | Walks every open PR with `base == main` | `check-pr-merge-conflicts-main` (singleton, `TERMINATE_IF_RUNNING` — newer main commit supersedes in-flight check) |
| `pull_request` action `opened \| synchronize \| reopened \| edited` (**secondary**) | Single PR only (the one in the payload) | `check-pr-merge-conflict-<prNumber>` (`TERMINATE_IF_RUNNING` per PR)                                               |

Both triggers run the same workflow type with a discriminated input.

|                |                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| Workflow       | `checkPrMergeConflicts` (deterministic, one activity call)                                               |
| Activity       | `runCheckPrMergeConflicts` (clone + merge-tree + status post)                                            |
| Queue          | `TASK_QUEUES.DEFAULT`                                                                                    |
| Auth           | Reuses `createGitHubAppInstallationToken()` from `src/lib/github-app-token.ts`                           |
| Status context | `ci/merge-conflict` — added to the main ruleset as a required check (see "GitHub ruleset" section below) |

## Files

| File                                                                 | Change                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/temporal/src/event-bridge/github-webhook.ts`               | (a) Accept `x-github-event: push`; verify HMAC; parse ref; if `refs/heads/main`, call `startCheckPrMergeConflictsForMain`. (b) In the existing `pull_request` branch, for actions `opened \| synchronize \| reopened \| edited`, also call `startCheckPrMergeConflictsForPr(prNumber, sha)` alongside the existing review/summary starts |
| `packages/temporal/src/event-bridge/github-webhook-schema.ts`        | Add `PushEventSchema` (zod) — `ref`, `repository.{owner.login,name}`, `after`                                                                                                                                                                                                                                                            |
| `packages/temporal/src/event-bridge/conflict-check-starts.ts` (new)  | `startCheckPrMergeConflictsForMain(client, {owner, repo, sha})` and `startCheckPrMergeConflictsForPr(client, {owner, repo, prNumber, sha, baseRef})`. Mirrors `pr-pipeline-starts.ts` shape                                                                                                                                              |
| `packages/temporal/src/workflows/check-pr-merge-conflicts.ts` (new)  | Deterministic workflow: one `proxyActivities` call; retry policy initial 5s, max 5 attempts, doubling. `startToCloseTimeout: 10 minutes`                                                                                                                                                                                                 |
| `packages/temporal/src/activities/check-pr-merge-conflicts.ts` (new) | The work: clone (blobless) → fetch refs → `git merge-tree` per PR → post commit statuses. Heartbeat every 10s                                                                                                                                                                                                                            |
| `packages/temporal/src/workflows/index.ts`                           | Re-export new workflow                                                                                                                                                                                                                                                                                                                   |
| `packages/temporal/src/activities/index.ts`                          | Register new activity                                                                                                                                                                                                                                                                                                                    |
| `packages/temporal/src/shared/schemas.ts`                            | `CheckPrMergeConflictsInputSchema` — discriminated union: `{ kind: "all-prs", owner, repo, mainSha }` or `{ kind: "single-pr", owner, repo, prNumber, headSha, baseRef }`                                                                                                                                                                |
| `packages/temporal/src/observability/metrics.ts`                     | Counters: `pr_merge_conflict_check_total{trigger="main\|pr", result="success\|failure\|errored"}`, histogram `pr_merge_conflict_check_duration_seconds{trigger}`                                                                                                                                                                         |
| `packages/homelab/src/tofu/github/rulesets.tf`                       | Add `required_check { context = "ci/merge-conflict" }` to the `monorepo_main` ruleset. **Apply only after step 2 of the rollout ordering below**                                                                                                                                                                                         |
| `packages/homelab/src/tofu/github/webhooks.tf` (new)                 | Import Buildkite + pr-bot repo webhooks; add `push` to pr-bot subscription so the temporal worker starts receiving main-push events. Same `tofu apply` as the ruleset edit; HMAC secrets `ignore_changes`'d.                                                                                                                             |

## Activity logic — local conflict detection

The activity NEVER reads GitHub's `mergeable` field. It only needs:

- the list of PR numbers + head SHAs + base refs (cheap REST/GraphQL),
- the actual git objects so it can do a 3-way merge locally.

### 1. Enumerate target PRs

- **`kind: "all-prs"`** — `octokit.paginate(rest.pulls.list, { state: "open", base: "main", per_page: 100 })`. Map to `{ number, headSha, baseRef }`. Filtering on `base: "main"` at the API level keeps PRs targeting other branches out (a push to main shouldn't paint statuses on a `gh-pages` PR).
- **`kind: "single-pr"`** — just one entry, taken straight from the webhook payload.

### 2. Clone + fetch

Same shape as `src/activities/data-dragon.ts`'s clone path (use `simple-git`), but blobless + no working tree:

```bash
git clone --filter=blob:none --no-checkout --bare \
  https://x-access-token:$TOKEN@github.com/$owner/$repo.git $tmp
cd $tmp
git fetch --filter=blob:none --no-tags origin \
  refs/heads/main:refs/heads/main \
  'refs/pull/*/head:refs/pull/*/head'
```

`--filter=blob:none` keeps the fetch fast (commit + tree objects only; blobs are lazily fetched on `merge-tree` if it touches them). `--bare` means no working tree, no checkout cost. `tmp` is `fs.mkdtempSync(...)` — fresh per activity run; no persistent cache for v1 (state is the enemy).

GitHub App auth: mint a fresh installation token via `createGitHubAppInstallationToken()` and pass via `x-access-token:<token>@` in the clone URL (same pattern as `data-dragon.ts:202`).

### 3. Detect conflicts with `git merge-tree`

For each PR:

```bash
git merge-tree --write-tree --merge-base=<merge-base> refs/heads/main refs/pull/<N>/head
```

- Exit `0` → clean merge, the tree OID is on stdout → **GREEN**.
- Exit `1` → conflict; stdout lists conflicted file stages then `CONFLICT (content)` lines → **RED**.
- Exit `>1` → real error (bad refs, OOM, etc.) → per-PR catch, log + Sentry, `result=errored`, post nothing for that PR (don't paint a misleading status).

`merge-base` is computed first via `git merge-base refs/heads/main refs/pull/<N>/head`. If there's no common ancestor (extremely rare — fork without shared history), skip the PR with `result=errored`.

Phase-0c confirms output shape: clean run is one line (tree OID); conflict run is tree OID then stage lines `^[0-7]+ <oid> [123]\t<path>` then human-readable `Auto-merging` / `CONFLICT (content):` lines. Conflict file paths are extracted from the stage lines.

### 4. Post commit statuses

For each PR, post to its head SHA:

```ts
await octokit.rest.repos.createCommitStatus({
  owner,
  repo,
  sha: pr.headSha,
  context: "ci/merge-conflict",
  state: hasConflict ? "failure" : "success",
  description: hasConflict
    ? `Conflicts with main in ${conflictedPaths.length} file(s)`
    : "Clean merge with main",
  target_url: temporalWorkflowUrl,
});
```

Same Octokit shape as `src/activities/pr-review/post-github.ts`. **No `pending` state** — local computation is deterministic; we always have a definitive answer.

### 5. Fan-out + failure handling

- **Concurrency cap 5** across PRs (status-post POSTs + per-PR `git merge-tree` invocations). Each `merge-tree` is sub-second; cap is for the GitHub REST secondary-rate-limit budget more than CPU.
- **Per-PR errors** (deleted head ref between list + fetch, malformed merge-base, etc.) are caught, logged with Sentry tag `component=pr-merge-conflict-check`, counted `result=errored`, and the activity continues.
- **Whole-activity errors** (clone fails, auth fails) bubble up — Temporal retries the activity per the workflow's retry policy.
- **Heartbeat** every 10s during the clone + per-PR loop so a worker death is detectable (90s heartbeat timeout). Same shape as `data-dragon.ts`.

## Webhook handler extension

`github-webhook.ts` currently early-returns on `event !== "pull_request"` (line 243). Two changes:

1. **New `push` branch** in the event dispatcher:

   ```ts
   if (event === "push") {
     const sigFailure = await verifyWebhookSignature(
       secret,
       payload,
       signature,
       deliveryId,
     );
     if (sigFailure !== null) return sigFailure;
     const parsed = PushEventSchema.parse(JSON.parse(payload));
     if (parsed.ref !== "refs/heads/main")
       return c.text("ignored: non-main ref\n");
     await startConflictCheckForMain({
       owner: parsed.repository.owner.login,
       repo: parsed.repository.name,
       mainSha: parsed.after,
     });
     return c.text("started\n");
   }
   ```

2. **Per-PR start inside the existing `pull_request` branch** — after the existing draft/author skips, alongside the existing `startWorkflows(baseInput)` call, also start the conflict check for actions `opened | synchronize | reopened | edited`:

   ```ts
   if (CONFLICT_CHECK_ACTIONS.has(action)) {
     await startConflictCheckForPr({
       owner: baseInput.owner,
       repo: baseInput.repo,
       prNumber: baseInput.prNumber,
       headSha: baseInput.commitSha,
       baseRef: baseInput.baseRef,
     });
   }
   ```

   The conflict check runs independently of the review/summary kill switch — `PR_BOT_ENABLED=false` only suppresses LLM workflows; merge-conflict status is cheap and useful regardless. (If we want one knob to gate both, gate later — start with always-on.)

The `buildWebhookApp(secret, startWorkflows, postStatus, startCancel)` signature gets two new injected start functions for testability, both defaulted to no-op.

## GitHub ruleset — required status check

Add `ci/merge-conflict` to the main-branch ruleset in `packages/homelab/src/tofu/github/rulesets.tf` alongside the existing two required checks:

```hcl
required_status_checks {
  strict_required_status_checks_policy = false

  required_check { context = "buildkite/monorepo/pr/white-check-mark-ci-complete" }
  required_check { context = "buildkite/monorepo/pr/mag-greptile-review" }
  required_check { context = "ci/merge-conflict" }   # ← new
}
```

The existing `bypass_actors` block (admin RepositoryRole, always-bypass) carries over, so an admin can still force-merge if needed.

**Critical rollout ordering** — applying the ruleset _before_ statuses exist will block every open PR on a missing check. Sequence is:

1. Ship the worker code (webhook + workflow + activity) — this PR. PRs get statuses on every PR-event the worker already receives. Push events do NOT yet flow.
2. Manually trigger a one-off `kind: "all-prs"` workflow run via Temporal UI (or the agent-task HTTP API) to paint every currently-open PR with a `ci/merge-conflict` status.
3. Confirm all open PRs show the check row.
4. Run `tofu apply` against `packages/homelab/src/tofu/github/` — this single apply enables BOTH the `push` event delivery to the worker (so subsequent main pushes re-evaluate every PR) AND the required-status-check entry in the ruleset.

Step 2 is the lever the kill switch + dry-run flags from Phase 0d give us: we can validate the painting works before the ruleset is enforcing.

## External prerequisite (one-time, manual)

The temporal worker's pr-bot webhook is a **repo webhook**, now managed by OpenTofu in `packages/homelab/src/tofu/github/webhooks.tf`. The `push` event subscription ships in the same `tofu apply` as the ruleset edit — see the rollout ordering below; nothing to click in the GitHub UI.

**GitHub App `Commits: write` permission** — granted on 2026-06-14. App token can now `POST /repos/{owner}/{repo}/statuses/{sha}`. (Not tofu-manageable; GitHub provides no API for App permission mutations.)

## Phase 0 — De-risk before building (do these first)

The whole design hinges on one assumption that is cheap to test in isolation: **can we overwrite a commit status at `(sha, ci/merge-conflict)` after the PR head has stopped moving?** Everything else is mechanical.

### 0a. Create a permanent test PR — DONE

PR #1240 opened: <https://github.com/shepherdjerred/monorepo/pull/1240> from branch `test/merge-conflict-check-fixture`. Single fixture file at `.test-fixtures/merge-conflict-check.md`. Title prefixed `[DO NOT MERGE]`. Head SHA: `7c51e8a78c8dd9636470f70f9a1edce2bef99fb0`.

### 0b. Status overwrite spike — DONE (PASS)

Posted `state=success` then `state=failure` to PR #1240's head SHA under `context: ci/merge-conflict`.

- Combined-status endpoint (`/commits/<sha>/status`, what the PR UI shows) returned exactly **one** `ci/merge-conflict` row that flipped from success → failure.
- Raw `/statuses` endpoint reports 2 records (per-POST audit trail; expected — does not affect display).
- Final placeholder `success` re-posted to leave the fixture PR clean.
- **Caveat**: spike used `gh`'s user PAT, NOT a GitHub App installation token. App's `Commits: write` permission still needs validation before shipping; the first App-token POST in the workflow will surface a 401 if missing.

### 0c. `git merge-tree` fixture test — DONE (PASS)

Scratch repo in `os.tmpdir()`: main `line A` → `line C`, `clean` branch edits unrelated file, `conflict` branch sets file to `line B`.

- `git merge-tree --write-tree --merge-base=$(git merge-base main clean) main clean` → exit `0`, stdout = single tree OID.
- `git merge-tree --write-tree --merge-base=$(git merge-base main conflict) main conflict` → exit `1`, stdout = tree OID + stage entries + `Auto-merging file.txt` / `CONFLICT (content): Merge conflict in file.txt`.

Activity parses exit code for RED/GREEN; conflicted paths come from stage lines.

### 0d. Kill-switch + dry-run from day one

`MERGE_CONFLICT_CHECK_ENABLED` (default `true`) and `MERGE_CONFLICT_CHECK_DRY_RUN` (default `false`) env vars wired into the activity from the first commit. Lets us flip behavior in prod without a code change.

Phase 0 gates passed — implementation can proceed.

## Verification

1. **Webhook unit tests** — extend `packages/temporal/src/event-bridge/github-webhook.test.ts`:
   - `push` to `refs/heads/main` → `startConflictCheckForMain` called with `{owner, repo, mainSha}`.
   - `push` to `refs/heads/feature/x` → start fn NOT called, 200 ignored.
   - `push` with bad signature → 401.
   - `pull_request: synchronize` → `startConflictCheckForPr` called with the PR number + head SHA.
   - `pull_request: closed` → conflict-check start fn NOT called (only the existing BK cancel runs).
2. **Activity unit test** — drive the activity with a fixture git repo created in `os.tmpdir()`:
   - Build a tiny repo with 2 commits on `main`, 2 PR branches (one rebased-clean, one with a conflicting edit to the same line).
   - Stub Octokit with `pulls.list` returning the two PRs and `repos.createCommitStatus` as a spy.
   - Assert: clean PR → `state:"success"`, conflicting PR → `state:"failure"` with the conflicted path in the description.
   - One extra fixture: PR head deleted between list + fetch → `errored` counter, no status posted, activity completes.
3. **Workflow bundle smoke test** — `bun test src/workflows/bundle.test.ts` must still pass (no activity imports leaking into the workflow file).
4. **Local end-to-end** — `GITHUB_WEBHOOK_SECRET=<scratch>` start the worker locally; `curl -X POST localhost:9466/webhook -H 'x-github-event: push' -H 'x-hub-signature-256: ...' --data @push.json`; watch the Temporal UI; verify a real-time clone+merge-tree completes inside the Temporal-UI activity logs.
5. **Production rollout** — after the App's push subscription is enabled and the worker pod ships:
   - Merge any small PR; the `ci/merge-conflict` status appears on every other open PR within a few seconds.
   - Deliberately create a conflicting PR; it turns RED.
   - Bring it up to date with main; it turns GREEN on the next push to main.
   - Run the one-off `kind: "all-prs"` workflow to backfill every existing open PR with a status.
   - Apply the ruleset change. Verify the test PR (PR #1240, fixture from 0a) shows `ci/merge-conflict` as a required check in its merge box.
6. **Metrics** — Grafana: `sum by (trigger,result)(rate(pr_merge_conflict_check_total[5m]))` shows non-zero `trigger=main,result=success` after each main push and `trigger=pr,...` traffic during normal PR activity. Histogram `pr_merge_conflict_check_duration_seconds` p99 should stay well under a minute even on a fleet of ~50 open PRs.

## Session Log — 2026-06-14

### Done

- Phase 0a — opened PR #1240 (`test/merge-conflict-check-fixture` → main) as the standing test fixture, head SHA `7c51e8a78c8dd9636470f70f9a1edce2bef99fb0`.
- Phase 0b — confirmed `(sha, ci/merge-conflict)` overwrite contract holds via raw + combined status endpoints; PR UI flips state on one row, no append.
- Phase 0c — confirmed `git merge-tree --write-tree --merge-base=…` exit-code semantics and output shape on a scratch repo for both clean and conflict cases.
- Plan mirrored from `~/.claude/plans/could-we-add-a-sequential-donut.md` to this file.

### Remaining

- Phase 0b residual: validate the GitHub App actually has `Commits: write` granted. First App-token POST during activity implementation will surface a 401 if not.
- Phase 1+ — Implementation: webhook handler extension, workflow + activity, schemas, metrics, scripts.
- External prereq — enable `push` event subscription on the GitHub App.
- Ruleset edit — landed only after step 2 of the rollout ordering succeeds in production.

### Caveats

- The fixture PR (#1240) must never be merged or closed; closure breaks the smoke-test path and the standing GREEN status. Document in the eventual feature PR's description.
- The status spike used a user PAT for convenience; App-token permission gap will be a real risk during implementation. Mitigation: surface and fix before merging the activity.

## Session Log — 2026-06-14 (PR #1252 review-thread fixes)

### Done

- Addressed 3 unresolved Greptile P2 threads on PR #1252 (commit `2ca2e4ffd`):
  - `packages/temporal/src/activities/check-pr-merge-conflicts-git.ts:44` — wrapped clone+fetch in try/catch so `askpassDir` (and any partially-cloned `workDir`) get `rm -rf`'d on clone failure instead of leaking into `/tmp` until pod restart. Steady-state cleanup still flows through the returned closure.
  - `packages/temporal/src/event-bridge/github-webhook.ts:173` — renamed push schema-parse-failed reason to `push:schema-parse-failed`, matching the adjacent `push:non-main-ref` convention so dashboards can disambiguate push vs pull_request schema failures.
  - `packages/homelab/src/tofu/github/webhooks.tf:23` — expanded the Buildkite hook comment to explicitly confirm the delivery-URL token trade-off (URL pre-existed in repo webhook settings; HMAC secret verified separately; rotation is a Buildkite-side one-click op). No code change to the URL itself.
- Replied + resolved all 3 review threads via GraphQL.
- Verified clean: `bun run typecheck`, `bun run lint`, `bun test src/event-bridge/github-webhook` (29 pass), `bun test src/activities/check-pr-merge-conflicts` (10 pass), `tofu -chdir=github validate`.
- No merge conflicts with `origin/main` (verified via `git merge-tree`).

### Remaining

- Wait for buildkite/monorepo/pr build #4416 to complete (in flight, monitoring).

### Caveats

- The Buildkite delivery-URL token decision is now documented in-source rather than asking the reviewer to re-derive it; if the security model ever changes, rotation remains a one-click op.
