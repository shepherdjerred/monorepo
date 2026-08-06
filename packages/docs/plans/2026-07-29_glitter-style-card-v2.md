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
- 2026-08-03 (repair-loop merged + deployed): PR #1982 merged (`c89baadf`);
  glitter worker rolled out on image `2.0.0-7932` (verified the fix in-pod). A
  pinned dry run then got **past** `2024-10-0000` (repair loop worked) but
  **failed** on `2023-03-0000`, where the model cited `1082466476296884314`
  (a real 2023-03-07 message) on **all 10 attempts** (2 Temporal retries × 5
  internal repairs, every seed). Deterministic-across-seeds ⇒ the ID is present
  in the model's _input_ — an ID embedded in another message's content (reply /
  link / quote) that is not a top-level chunk message. Repairs + seed variation
  cannot fix this: the model is correctly reading its input; the strict validator
  just can't accept an in-content ID.
- 2026-08-03 (sanitization fix): Operator chose to sanitize at the LLM boundary.
  `fix/glitter-extraction-sanitize` adds `sanitizeChunkSummary`
  (`glitter-context-refresh-style-validation.ts`, split out with
  `validateChunkSummary` to stay under the 500-line cap): after the (now 2)
  repair attempts, drop any observation citing a message ID not in the chunk's
  known set (the whole observation, not just the offending ID — stripping only the
  unknown ID would launder an unsupported claim onto its surviving citation), and
  drop non-verbatim/duplicate representatives — a chunk the model can never cite
  cleanly degrades to its fully-verifiable subset instead of failing the whole run
  (untrusted model output is boundary input, the repo's explicit fail-fast exception). `MAX_EXTRACTION_REPAIR_ATTEMPTS`
  cut 4→2 to bound spend on systematically-failing chunks since sanitization now
  guarantees convergence. Three Codex P2s addressed on the PR: (1) drop the _whole_
  observation on any unknown ID rather than stripping IDs (no laundering an
  unsupported claim onto a surviving citation); (2) a chunk that sanitizes to
  _nothing_ (no observations, no representatives) is rejected with a hard error —
  returning it would let `finalizeStyleSynthesis` advertise full coverage while
  silently omitting the month; (3) repairs are non-monotonic, so `summarizeChunk`
  sanitizes _every_ attempt and keeps the one with the most verifiable evidence,
  failing only when all attempts sanitize to nothing (a worse final repair can't
  discard an earlier attempt's valid observations). Tests: a partially-unfixable
  chunk completes (seeds `[0,1,2]`), a fully-unverifiable chunk throws `yielded no
verifiable evidence`, an earlier-attempt-has-evidence case still completes, and
  a direct `sanitizeChunkSummary` unit test proves only fully-verifiable
  observations survive and non-verbatim representatives drop.
  Next: land + deploy, then re-run Phase 1 (cached good chunks, incl.
  `2024-10-0000`, reuse for free; `2023-03-0000` now sanitizes to its verifiable
  subset).
