---
id: plan-2026-07-29-glitter-style-card-v2
type: plan
status: in-progress
board: true
verification: operator
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

- [ ] Introduce the transitional V1/V2 schemas, coverage contract,
      `StylePromptContext`, JSON Schema, Python model, fixtures, and tests.
- [ ] Implement complete-corpus monthly chunking, Luna extraction artifacts,
      Sol synthesis, field-level patching, semantic validation/repair, and
      exact evidence checks.
- [ ] Implement SeaweedFS artifact reuse, usage accounting, preflight estimates,
      run budgets, operator flags, and the $10 scheduled ceiling.
- [ ] Wire thick V2 contexts through Birmel and Scout while retaining legacy
      behavior and add consumer sentinel tests.
- [ ] Update Temporal rehearsals and operator documentation.
- [ ] Run focused builds, typechecks, tests, lint, docs checks, and affected
      verification; publish a draft implementation PR through git-spice.
- [ ] Merge and deploy the implementation, run the pinned $50 dry run twice,
      promote the cached run, review and merge all 13 V2 cards, smoke-test
      Birmel and Scout, close PR #1834, and resume the weekly schedule.

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

- [ ] Complete the implementation and publish its draft PR.
- [ ] Complete the production generation, review, deployment, and schedule
      activation gates.

## Comment Log

- 2026-07-29: Approved design selects Luna extraction, Sol synthesis,
  field-level preservation, exact 20/30/18 content counts, and thick Birmel and
  Scout contexts.

## Session Log — 2026-07-29

### Done

- Recorded the approved V2 generation, consumer, cost-control, and rollout
  design.

### Remaining

- Implement, verify, publish, deploy, seed, and activate the workflow using the
  gates above.

### Caveats

- PR #1834 remains the source for three stronger descriptive baselines and must
  stay open until a replacement data PR exists.
- The weekly context-refresh schedule remains intentionally paused during
  implementation and acceptance.
