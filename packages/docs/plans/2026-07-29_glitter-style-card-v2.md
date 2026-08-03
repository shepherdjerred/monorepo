---
id: plan-2026-07-29-glitter-style-card-v2
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Glitter Style-Card V2 and Thick-Context Rollout

## Outcome

Generate evidence-grounded style cards from the complete safe Discord corpus,
preserve the strongest existing observations, and deliver full-fidelity style
contexts to Birmel and Scout. Complete the rollout with deterministic cached
dry runs, a reviewed data PR, deployed consumers, and an intentionally resumed
weekly production schedule.

## Design

### Evidence pipeline

- Analyze every safe message in deterministic UTC-month chunks of at most 250
  messages.
- Use `gpt-5.6-luna` for high-volume chunk extraction and
  `gpt-5.6-sol` for final synthesis.
- Give synthesis every chunk summary plus the latest 500 safe raw messages.
- Cache raw structured model artifacts immutably in SeaweedFS before semantic
  validation so retries and dry-run-to-real promotion reuse paid work.
- Apply field-level patches to the prior card. Retained observations are copied
  exactly; removals require contradictory evidence or explicit low-confidence
  judgment.

### V2 card contract

- Add explicit schema and coverage metadata that distinguishes complete corpus,
  safe evidence, summarized messages, chunk count, direct recent messages, date
  ranges, strategy, and source snapshot checksum.
- Persist exactly 20 corpus-verbatim quotes and 30 corpus-verbatim sample
  messages.
- Persist 18 clearly marked synthetic examples: three each for happy, angry,
  sad, supportive, playful, and neutral situations.
- Keep descriptive prose between 85% and 115% of the reference card's prose
  length.
- Use the stronger descriptive fields from the generated Caitlyn, Colin, and
  Richard cards in PR #1834 as synthesis baselines.
- Parse legacy and V2 cards during migration, but generate V2 only. Remove
  legacy support only after all 13 V2 cards have merged.

### Consumer contract

- Define a shared `StylePromptContext` containing every descriptive field, all
  20 quotes, all 30 samples, and all 18 situational examples. Omit only
  `schemaVersion` and `coverage`.
- Keep Birmel's compact formatting for legacy cards. Give the Birmel
  supervisor, subagents, and should-respond classifier the complete thick
  context for V2 cards.
- Make Scout frontend and backend built-ins serialize the complete shared
  context. Preserve custom free-form prompt strings unchanged.
- Add sentinel tests proving the last entry of every large collection reaches
  each consumer and operational metadata does not.

### Cost and rollout controls

- Add preflight estimates and hard run budgets. Use a $50 ceiling for the
  pinned cold rollout and $10 for the weekly schedule.
- Report cache reads/writes, token use, estimated cost, and artifact identity in
  workflow results.
- Keep `glitter-context-refresh-weekly` paused until two pinned deterministic
  dry runs match, the real run reuses those artifacts, the V2 data PR is
  reviewed and merged, consumers pass smoke tests in production, and the
  schedule is deliberately resumed.
- Keep PR #1834 open until its V2 replacement exists, then close it as
  superseded.

## Implementation

- [x] Introduce the transitional V1/V2 schemas, coverage contract,
      `StylePromptContext`, JSON Schema, Python model, fixtures, and tests.
- [x] Implement complete-corpus monthly chunking, Luna extraction artifacts,
      Sol synthesis, field-level patching, semantic validation/repair, and
      exact evidence checks.
- [x] Implement SeaweedFS artifact reuse, usage accounting, preflight estimates,
      run budgets, operator flags, and the $10 scheduled ceiling.
- [x] Wire thick V2 contexts through Birmel and Scout while retaining legacy
      behavior and add consumer sentinel tests.
- [x] Update Temporal rehearsals and operator documentation.
- [x] Run focused builds, typechecks, tests, lint, docs checks, and affected
      verification; publish a draft implementation PR through git-spice.
- [x] Merged and deployed the implementation: PR #1846 (`56f28ee7`,
      "feat(glitter-context): generate V2 thick evidence contexts") through
      Buildkite and review, per
      `2026-07-27_glitter-corpus-live-rollout.md`.
- [ ] Run the pinned $50 dry run twice, promote the cached run, review and
      merge all 13 V2 cards, smoke-test Birmel and Scout, close PR #1834, and
      resume the weekly schedule.

## Verification

- Schema fixtures cover valid V1/V2 cards and reject malformed counts,
  provenance, coverage, and metadata leakage.
- Chunk tests prove complete safe-message coverage, deterministic ordering,
  UTC-month boundaries, and the 250-message ceiling.
- Generator tests prove exact quote/sample provenance, field retention,
  justified removals, prose bounds, one repair attempt, cache reuse, and budget
  refusal before uncached spend.
- Birmel and Scout tests assert full counts plus final-entry sentinels across
  every relevant prompt path.
- Two production dry runs over the same pinned snapshot produce byte-identical
  proposal checksums and the real run records artifact cache hits.
- Buildkite, deployed digest, ArgoCD health, consumer smokes, and the schedule's
  next action are verified separately before completion.

## Remaining

Verified live state on 2026-08-03 (Temporal UI + `main`): the workflow code is
merged/deployed (#1846), the isolated `glitter` worker is up and polling
`glitter-context` + `glitter-corpus`, and `glitter-corpus-daily` is healthy. But
`main` still holds **legacy V1** cards (old `coverage` shape, no `schemaVersion`,
no 18 situational examples; `generation-state.json` is an empty scaffold), the
2026-07-29 real-run proposal branch has been deleted, and no V2 data PR is open.
The schedule remains paused. The ordered checklist to finish:

### Phase 0 — Preflight (no spend) — COMPLETE

- [x] `OPENAI_API_KEY` (Homelab vault `temporal-worker-secrets`) verified healthy
      2026-08-03: `GET /v1/models` → 200, both `gpt-5.6-luna` and `gpt-5.6-sol`
      available, live `/v1/responses` call on luna → 200 (quota OK, not the 429
      the 2026-07-29 runs hit).
- [x] `costForTextUsage` pricing present: luna $1/$6 per M in/out, sol $5/$30.
- [x] Confirm the `glitter` worker is polling `glitter-context` (verified
      2026-08-03 19:47, poller `temporal-temporal-glitter-worker-…`).
- [ ] Decide the source snapshot: reuse the proven pinned snapshot
      (`dbb59f00-3f6b-4cab-a87c-6d8a65e21d62`,
      sha `e4253d20…`, cached artifacts → near-free deterministic reproduction of
      `proposalSha256=9f558af0…`) or regenerate against the newer corpus
      (full spend). Trigger:
      `bun run glitter:operate context-refresh --dry-run=… --max-estimated-cost-usd=… [--snapshot-id=… --snapshot-sha256=…]`
      via `kubectl port-forward svc/temporal-temporal-server-service 7233:7233 -n temporal`.

### Phase 1 — Regenerate the V2 proposal

- [ ] Run two pinned deterministic dry runs ($50 ceiling); confirm byte-identical
      `proposalSha256`.
- [ ] Run the real run reusing those cached artifacts → outcome `pr-created`
      (re-emits the 13–14 V2 cards + `generation-state.json`, opens a fresh PR).

### Phase 2 — Review & merge the data

- [ ] Human-review the V2 data PR: spot-check 20 quotes / 30 samples / 18
      situational examples / `coverage` + `schemaVersion` present per card.
- [ ] Merge → `main` flips V1 → V2; confirm `@shepherdjerred/glitter-context`
      rebuilds `dist/` with the new data for consumers.

### Phase 3 — Consumer smoke tests (production)

- [ ] Birmel: supervisor, subagents, and should-respond classifier receive the
      full thick `StylePromptContext` for V2 cards.
- [ ] Scout: frontend + backend built-ins serialize the full shared context.
- [ ] Confirm deployed digests / ArgoCD health for Birmel + Scout picked up the
      new data.

### Phase 4 — Go live

- [ ] Un-pause `glitter-context-refresh-weekly` in the Temporal UI (Schedules).
- [ ] Confirm the next scheduled action (Mon 11:00 PT) under the $10 weekly
      ceiling.

### Phase 5 — Close out

- [x] Close PR #1834 as superseded (already CLOSED).
- [ ] Set this plan `status: complete` and move it to `archive/completed/`.

## Comment Log

- 2026-07-29: Approved design selects Luna extraction, Sol synthesis,
  field-level preservation, exact 20/30/18 content counts, and thick Birmel and
  Scout contexts.
- 2026-08-03 (execution attempt): Phase 0 passed. Ran a pinned dry run
  (snapshot `dbb59f00…`) expecting cached-artifact reuse. Instead the 2026-07-29
  SeaweedFS artifacts are **expired/cold**, so it regenerated from scratch and
  **FAILED** (`glitter-context-refresh-manual-70d55356…`, 20:02→20:12, both
  activity attempts): `chunk 2024-10-0000 observation cites unknown message IDs:
1296836613842944112`. Root-caused read-only: `chunkPrompt` shows the model only
  the sub-chunk's messages and `validateChunkSummary` builds `knownIds` from that
  same set (consistent — not a code mismatch); `gpt-5.6-luna` simply emitted a
  citation outside its supplied set, the single repair attempt also missed, and
  both outputs are cached pre-validation (`readOrCreateGenerationArtifact`,
  key `guilds/<id>/derived/glitter-context/generation-artifacts/…`, request hash
  includes a fixed `DETERMINISTIC_SEED`) → the chunk is now **poison-cached** and
  fails deterministically on retry. This is the same stochastic
  extraction-compliance failure that killed 3 runs on 2026-07-29; those passed by
  eventually landing a clean pass whose artifacts got cached, and that cache has
  since expired. Net: the "reuse pinned cache → near-free" path is no longer
  available; getting to green now requires either lucky clear-and-retry (risky —
  the fixed seed may reproduce the bad output) or a code fix hardening extraction
  reliability. Escalated to the operator for a path decision. Spend bounded (early
  failure, well under the $50 ceiling; exact receipt not surfaced in logs).
- 2026-08-03: Live status audit. Workflow proven working on 2026-07-29 (two dry
  runs matched `proposalSha256=9f558af0…`; real run `outcome=pr-created`), but
  that branch/PR was never merged and is now deleted, so `main` is still V1 and
  the schedule stays paused. The isolated glitter worker (#1972, merged
  2026-08-03) is up and polling both glitter queues. Rewrote `## Remaining` as an
  ordered Phase 0–5 checklist; the blocking work is regenerating and merging a
  fresh V2 data PR (Phase 1–2), everything else is downstream of it.
- 2026-08-03 (fix): Operator chose to harden extraction rather than gamble on
  clear-and-retry. `fix/glitter-extraction-repair-loop` converts the single
  chunk-extraction and synthesis repair steps into bounded loops
  (`MAX_EXTRACTION_REPAIR_ATTEMPTS=4`, `MAX_SYNTHESIS_REPAIR_ATTEMPTS=3`) where
  each attempt uses `DETERMINISTIC_SEED + attempt`. Attempt 0 keeps seed 0 (its
  cache key is unchanged, so valid prior artifacts still reuse), and each repair
  gets a distinct seed → a genuinely fresh, cache-distinct model call that a
  fixed-seed retry could not produce, while staying deterministic by attempt
  index (a re-run reuses the first attempt that passed). No loosening of the
  evidence validator. Added two loop tests to
  `glitter-context-refresh-generate.test.ts` (poisoned→clean succeeds with seeds
  `[0,1]`; persistent failure throws after seeds `[0,1,2,3,4]`). Next: land +
  deploy the worker, then re-run Phase 1 (the poisoned `2024-10-0000` artifact
  stays cached but now just triggers the repair loop instead of failing).

## Session Log — 2026-07-29

### Done

- Created draft PR #1846 with the transitional shared schema and metadata-free
  `StylePromptContext`.
- Implemented complete safe-corpus UTC-month chunking, Luna extraction, Sol
  synthesis, field-level retention/removal rules, deterministic finalization,
  one repair attempt, immutable SeaweedFS artifacts, and run-budget reporting.
- Added the explicit `$50` operator flag and configured the paused weekly
  schedule with a `$10` uncached ceiling.
- Wired V2 thick contexts through the Birmel supervisor, all subagents,
  should-respond classifier, and Scout frontend/backend built-ins while keeping
  legacy Birmel and custom Scout inputs compatible.
- Applied only the stronger descriptive fields from PR #1834 for Caitlyn,
  Colin, and Richard as synthesis baselines.
- Added direct last-entry and metadata-leak sentinels for Birmel's classifier
  and Scout's shared frontend/backend prompt serializer.
- Passed the serialized affected verification surface (79/79 tasks), 765
  Temporal tests, 1,213 Scout backend tests, 94 Scout report tests, focused
  Birmel and Scout sentinel tests, and forced consumer typecheck/lint.
- Addressed both P2 findings from the first Codex review: summary and League
  now use evidence-backed patch decisions, and billed parse failures are
  persisted before throwing so activity retries cannot spend twice.
- Addressed the replacement review's spend-safety findings: every
  post-completion artifact-finalization failure is non-retryable with billed
  usage in its failure details, and the weekly workflow deadline now covers
  both complete seven-hour activity attempts plus backoff.
- Preserved atomic first-writer response convergence while charging a
  conditional-create loser for its own completion usage rather than the
  winner's stored usage.
- Added immutable, run-owned spend receipts so an activity retry restores the
  billed prefix before authorizing new model calls, while cache hits produced
  by prior workflow runs remain free. Budget exhaustion and post-budget
  overflow now fail non-retryably.
- Made a returned OpenAI completion with missing, malformed, or unaccountable
  usage fail non-retryably at the provider boundary, because the request may
  already have been billed even though no safe receipt can be written.
- Hardened the native Temporal good-morning integration cases against
  full-repository CI contention after build #7180 exposed Bun's 5-second
  default timeout; all five repeated focused runs passed with the explicit
  integration-test timeout.
- Published the complete implementation to draft PR #1846 through git-spice.

### Remaining

- Drive PR #1846 through Buildkite and review to merge.
- Deploy the worker/consumers, complete the two pinned `$50` dry runs and cached
  real run, review and merge the V2 data PR, smoke-test consumers, close #1834,
  and resume the weekly schedule.

### Caveats

- PR #1834 remains the source for three stronger descriptive baselines and must
  stay open until a replacement data PR exists.
- The weekly context-refresh schedule remains intentionally paused during
  implementation and acceptance.
- Current canonical data remains legacy V1 until the production workflow emits
  and the human-reviewed replacement PR merges all 13 V2 cards.
