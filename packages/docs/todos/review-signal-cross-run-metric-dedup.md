---
id: review-signal-cross-run-metric-dedup
type: todo
status: planned
board: true
verification: agent
disposition: active
origin: packages/docs/logs/2026-07-25_pr-1657-review-gate-hardening.md
source_marker: false
---

# Deduplicate review-signal metrics across scheduled collector scans

## What

`review-signals-collect` (`observeReviewSignalsWorkflow`,
`src/activities/observe-review-signals.ts`) runs every 6 hours and re-scans the
same ~30 most-recently-updated PRs. Each run unconditionally re-increments the
`review_*` Prometheus counters/histograms
(`review_findings_total`, `review_completion_signal_total`,
`review_findings_per_pr`, `review_completion_latency_seconds`,
`review_reviewed_head_total`, `review_stale_reaction_total`) for every observed
`(provider, PR, head)` — so a PR that stays "recent" across several runs is
counted multiple times, over-weighting it and biasing the latency percentiles.

Raised as a Codex P2 on PR #1657 (`register-schedules.ts:348`); deferred
there (see [[pr-1657-review-gate-hardening]]) because a correct fix needs new
persistent state, out of proportion for the Greptile→Codex cutover.

A second Codex P2 on the same PR (`observe-review-signals.ts:339`, "make
collector side effects idempotent across retries") is folded in here: Temporal's
at-least-once completion means the activity can re-run after a successful
upload + metric recording (a lost completion ack), re-incrementing every
non-idempotent Prometheus counter. The **archive** side of that was already made
idempotent on PR #1657 (the NDJSON object is now keyed by the stable workflow
run id, so a retry overwrites rather than duplicates). The **metric** side needs
the same persistent seen-set as the cross-run case — a key that has already been
recorded is skipped — which is why both concerns share this todo.

## Why it's open

- The intra-run double-count on activity retry was already fixed in PR #1657
  (metrics now recorded once, after the S3 upload succeeds). This todo is only
  the **cross-run** inflation.
- The raw NDJSON archive (`review-signals/<temporal-run-id>.ndjson` in
  `llm-archive` — keyed by the workflow run id, one object per collection run)
  already records **every** observation with its `(provider, pr, head_sha)`, so
  accurate offline analysis is unaffected today — only the live Prometheus
  counters inflate. There is no dashboard consuming these metrics yet, so the
  impact is currently latent.

## Remaining

- [ ] Add an S3 `get` helper alongside `putS3Object` in
      `packages/temporal/src/shared/s3.ts` (none exists yet).
- [ ] Persist a seen-observation set keyed by `(provider, pr, head_sha)` (e.g. a
      rolling JSON object in the archive bucket, pruned to a bounded window such
      as the last N days) and load it at the start of each collector run.
- [ ] Record `review_*` metrics only for observations whose key is NOT already
      in the seen-set; still archive every observation to NDJSON regardless.
      Persist the updated seen-set as the final step (mirror the "record metrics
      after upload succeeds" ordering so a retry cannot double-persist). This
      same seen-set closes the Temporal at-least-once retry double-count
      (`observe-review-signals.ts:339`), not just the cross-scan case.
- [ ] Handle a seen-set read failure conservatively (fail the run so Temporal
      retries, rather than silently reverting to counting everything).
- [ ] Extend `src/shared/review-signals.test.ts` (or a new test) to cover the
      dedup: the same `(provider, pr, head)` observed across two runs increments
      each counter once.
