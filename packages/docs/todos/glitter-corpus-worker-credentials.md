---
id: glitter-corpus-worker-credentials
type: todo
status: in-progress
board: true
verification: agent
disposition: active
origin: packages/docs/logs/2026-07-26_pr-1700-glitter-shared-context.md
source_marker: false
---

# Complete quota-gated Glitter context refresh acceptance

The Discord and SeaweedFS credentials are provisioned in 1Password, wired into
the deployed Temporal worker, and covered by the committed non-secret vault
snapshot. The trusted seed, full backfill, daily capture, recovery verification,
and observability gates all pass. `glitter-corpus-daily` is active in production.

The Temporal worker's OpenAI project was topped up without changing its
credential. The pinned production rehearsal then reused nine existing
SeaweedFS generation artifacts and generated only the four missing style cards.
Two dry runs returned the same proposal checksum, and the real run opened
human-review PR [#1834](https://github.com/shepherdjerred/monorepo/pull/1834)
without making additional OpenAI calls.

## Remaining

- [x] Restore usable quota for the project that owns the Temporal worker's
      existing `OPENAI_API_KEY`.
- [x] Rerun the fixed-time dry run twice against snapshot
      `dbb59f00-3f6b-4cab-a87c-6d8a65e21d62` at SHA-256
      `e4253d203408efe65f4ad4199ccaebf3c83df68a182ce816865f6abc43837ff9`
      and require complete output equality.
- [x] Run the real refresh with the same pin, inspect its sole PR, and complete
      pre-merge package-level smoke tests for the shared package, Birmel, Scout,
      and Glitter consumers.
- [ ] Correct #1834's coverage metadata so verified-corpus message counts remain
      distinct from the bounded 200-message model evidence sample; regenerate and
      re-review affected cards if the correction changes generated content.
- [ ] Decide and record whether Glitter style cards are recent-behavior snapshots
      or cumulative personas. If recent snapshots are selected, explicitly record
      the bounded recent-window contract. If cumulative personas are selected,
      implement time-stratified sampling and/or field-level merge behavior that
      retains uncontradicted observations, regenerate the proposal, and re-review
      Jerred, Virmel, Brian, Danny, Edward, Hirza, Irfan, and Ryan before
      acceptance.
- [ ] Complete #1834's current-head Buildkite after the metadata correction and
      any persona-contract implementation work.
- [ ] When pre-merge agent work is complete, set this TODO to
      `status: awaiting-human` and `verification: human`.
- [ ] Add a `## Human Verification` scenario: review the generated style cards
      for accurate, socially acceptable personas and explicitly accept or reject
      the proposal.
- [ ] After human acceptance, return this TODO to `status: in-progress` with
      `verification: agent`, merge #1834, and run merged-main and production
      consumer smoke checks.
- [ ] Unpause `glitter-context-refresh-weekly` only after those acceptance
      gates pass, then complete and archive this TODO and the live rollout plan.

## Comment Log

- 2026-07-26 — Filed from PR #1700 review (Codex P1 "Wire the required corpus
  credentials into the worker"). Code wiring was drafted and verified to fail
  `check:1password` because the 1P fields do not yet exist; reverted to keep CI
  green. Schedules already fail-safe (auto-paused as unconfigured).
- 2026-07-29 — Discord and SeaweedFS credentials, worker wiring, deployment,
  seed, backfill, daily schedule, recovery, and observability are complete.
  Removed obsolete R2 and provisioning tasks. The only remaining operator
  boundary is OpenAI project quota; weekly refresh remains deliberately paused.
- 2026-07-29 — Re-audited the live Ready worker, ArgoCD application, and both
  schedules, then retried the exact fixed-time, snapshot-pinned dry run as
  workflow `glitter-context-refresh-manual-a3f6ec23-cb6d-45db-9766-f75009766b00`.
  Both configured attempts again reached OpenAI and failed closed on HTTP 429
  `insufficient_quota`; no branch, PR, or context mutation occurred.
- 2026-07-29 — Probed the credential directly from the deployed worker without
  exposing it. The configured key successfully read the `gpt-5.6-sol` model,
  while a minimal completion failed with HTTP 429 `insufficient_quota`
  (`req_3b7c0ed562be4905ae4c68e65f2e71ba`). Kubernetes identifies the source as
  1Password item `mjgnqqh37jxyzseqrddde2jgaq`, version `19`,
  `OPENAI_API_KEY`. The API returned no project or organization header, and a
  metadata-only 1Password lookup timed out; the operator must identify that
  key's owning project in the OpenAI dashboard and restore quota there.
- 2026-07-29 — The operator topped up the existing OpenAI project. The next
  pinned dry run reused nine generation artifacts, generated the four missing
  cards, and completed with proposal SHA-256
  `9f558af01bf18f2082499c61cd400b44b27bb1e0f93e878978c1cf785e582538`.
  A second dry run returned the same result with zero OpenAI calls. The real
  run reused the same proposal with zero OpenAI calls and opened PR #1834.

## Session Log — 2026-07-29 (quota restoration and cached acceptance)

### Done

- Verified the cache-enabled production worker and recovery-verified pinned
  corpus snapshot.
- Completed the first dry run by reusing nine immutable generation artifacts
  and generating only the four missing style cards.
- Completed a second byte-identical dry run and the real refresh with zero
  additional OpenAI calls; all three returned proposal SHA-256
  `9f558af01bf18f2082499c61cd400b44b27bb1e0f93e878978c1cf785e582538`.
- Opened generated-context PR #1834 and passed focused build, typecheck, test,
  and lint for Glitter context, Birmel, Scout data, and the Glitter app.

### Remaining

- Complete human review and current-head Buildkite #7145 for PR #1834.
- Merge PR #1834, run merged-main and production consumer smoke checks, then
  deliberately unpause `glitter-context-refresh-weekly`.
- Complete and archive this TODO and the live rollout plan.

### Caveats

- The weekly schedule remains deliberately paused.
- PR #1834 requires subjective human review and is never auto-merged.
- The generated-context proposal is cached; review, CI, and real-run retries do
  not require another OpenAI generation.
- Current-head Buildkite #7145 is scheduled but cannot start while the
  dedicated CI node `liskov` is offline; Kubernetes last received its heartbeat
  at 11:04 PDT and deliberately does not fall back to the production node.

## Session Log — 2026-07-29 (acceptance-gate correction)

### Done

- Distinguished completed pre-merge package smoke tests from the required
  merged-main and production consumer smoke checks.
- Added the uncompleted metadata correction that must keep verified-corpus
  coverage distinct from the bounded 200-message model evidence sample.
- Recorded the staged transition from pre-merge agent verification to human
  acceptance, followed by post-merge agent verification.

### Remaining

- Correct #1834's metadata and complete current-head CI, then transition this
  TODO to `awaiting-human` / `verification: human` for subjective review.
- After acceptance, return the TODO to agent verification, merge #1834, and run
  merged-main and production consumer smoke checks before schedule unpause.

### Caveats

- PR #1834's Buildkite #7145 failed during bootstrap pipeline upload with a
  `stack_error`; no repository verification job ran.
- The weekly schedule remains paused, and this document does not treat the
  generated content or any remaining acceptance gate as complete.

## Session Log — 2026-07-29 (human-review ordering correction)

### Done

- Removed the circular requirement for merged-main and production smoke checks
  before the generated-content review that must precede merge.
- Aligned this TODO with the rollout plan's pre-merge agent, human acceptance,
  and post-merge agent phases.

### Remaining

- Correct #1834's coverage metadata and complete its current-head CI.
- Move this TODO to `awaiting-human` / `verification: human`, complete the
  observable generated-content review, then return it to agent verification for
  merge and post-merge smoke checks.

### Caveats

- The existing pre-merge package smoke evidence remains complete.
- PR #1834, merged-main checks, production consumer smokes, weekly-schedule
  unpause, and final acceptance all remain incomplete.

## Session Log — 2026-07-29 (persona-contract gate)

### Done

- Added the missing pre-acceptance decision gate for recent-behavior snapshots
  versus cumulative personas.
- Documented the required conditional work before human acceptance: record the
  bounded recent-window contract when snapshots are intended, or implement
  cumulative sampling/merge behavior, regenerate, and re-review all eight cards
  when cumulative personas are intended.

### Remaining

- Choose and record the Glitter style-card persona contract.
- If cumulative personas are selected, implement time-stratified sampling and/or
  field-level merge behavior that retains uncontradicted observations, regenerate
  the proposal, and re-review Jerred, Virmel, Brian, Danny, Edward, Hirza, Irfan,
  and Ryan before acceptance.
- Correct the corpus metadata and complete PR #1834's current-head Buildkite run.
- Transition this TODO and the rollout plan to human verification, then complete
  the eight-card subjective review before merge.
- After acceptance, return the workflow to agent execution, merge PR #1834, run
  the merged-main and production consumer smokes, and only then unpause Glitter
  and complete/archive the records.

### Caveats

- No persona-contract decision has been made; the generated cards remain pending
  acceptance.
- The current implementation behaves as a bounded recent-window rewrite despite
  earlier preservation language, so cumulative-persona acceptance requires the
  implementation and re-review work above.
