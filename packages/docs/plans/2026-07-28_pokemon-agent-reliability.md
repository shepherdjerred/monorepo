---
id: plan-pokemon-agent-reliability-2026-07-28
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Pokemon Goal-Agent Reliability

## Summary

Build a general Pokemon Emerald-playing agent rather than a scripted quest
solver. Prioritize trustworthy game observations, interruptible semantic
controls, and a compact observe-plan-act-verify prompt. Add encyclopedic
retrieval and dynamically loaded skills as supporting context, then measure the
system against a copied live save and the exact goal `get me a pokeman`.

## Implementation

### 1. Authoritative observations and controls

- Add a versioned C-to-WASM observation bridge for phase, readiness, map,
  position, collision, nearby objects, party, inventory, battle/menu/dialog
  state, badges, Pokedex, and named progression flags.
- Add a serialized, frame-aware controller with reliable discrete inputs,
  stable-state settling, context-change interruption, and evidence-backed
  outcomes.
- Make `observe`, `tap`, `move`, `interact`, `wait`, `map show`, and bounded
  current-map `navigate` the primary `pokemonctl` interface. Keep raw controls
  as an escape hatch.

### 2. Prompt and operating loop

- Upgrade the pinned Codex CLI and separate stable developer instructions from
  untrusted objective JSON.
- Replace the static Pokemon lecture with a compact
  observe-plan-act-verify-adapt loop, bounded screenshots, explicit recovery,
  and prompt/context budgets.
- Keep runtime goal completion semantics unchanged; achieved/unmet final-report
  markers are diagnostic only.

### 3. Secondary knowledge

- Pin and import pokeemerald-wasm, Archipelago Emerald, Emerald-filtered
  PokeAPI data, and the full 22-part Bulbapedia walkthrough.
- Keep Bulbapedia material isolated and attributed under CC BY-NC-SA 2.5.
- Generate validated, language-neutral, provenance-bearing search records.
- Add bounded `pokemonctl knowledge search/get` commands and focused world,
  progression, species, items, and battle skills.
- Extend the existing Temporal refresh and copy the corpus/skills into the
  runtime image.

### 4. Measurement and delivery

- Run three untouched real-model baselines from fresh copies of the same live
  save, then three runs after controls, prompt, and knowledge phases.
- Define benchmark success as a catch event plus persisted party/Pokedex/save
  evidence, never process exit or prose.
- Record runtime, actions, stop reasons, repeated-position loops, ignored
  inputs, screenshots, knowledge queries, tokens, cost, hashes, and trace IDs.
- Require three consecutive successful clean-copy runs before the final model
  comparison and production trial.
- Deliver the work as a small git-spice stack with focused verification and
  visual evidence.

## Remaining

- [x] Implement and verify the observation/control foundation.
- [x] Implement and verify the compact prompt and benchmark harness.
- [x] Implement and verify the knowledge corpus, retrieval, and skills.
- [ ] Complete repeated local evaluation and iterate on failures.
- [ ] Publish the review-ready stack and record CI/live verification.

## Comment Log

- 2026-07-28: Approved for implementation. Controls and prompt are the
  critical path; skills are explicitly secondary.
- 2026-07-28: The untouched-agent baseline completed with zero successful
  catches in three runs (33m42s, 312 tool calls, 32.4M input tokens, estimated
  cost $5.07). The candidate evaluator now requires exact catch-species
  correlation through event, live party/Pokedex state, and persisted save
  evidence.
- 2026-07-28: Integration review found and corrected start/shutdown and
  process/lease races, plus a production-shape movement telemetry mismatch.
  `/goal` is restricted to the active session starter; full isolated runner
  architecture remains tracked in
  `packages/docs/todos/pokemon-goal-runner-isolation.md`.
- 2026-07-28: Candidate evaluation exposed incorrect wasm32 SaveBlock offsets,
  action outcomes that ignored battle cursor and visible dialog changes,
  oversized semantic responses, limited active-object visibility, and provider
  failures counted as game failures. Those defects are fixed and covered by
  focused tests.
- 2026-07-28: A manual general-control run beat May, received the Pokedex and
  five Poke Balls, and visibly caught a Poochyena. That run exposed a separate
  teardown defect: the host copied stale flash because Emerald had not
  serialized live RAM. The new engine checkpoint uses Emerald's canonical save
  path, ordered atomic host writes, and an independent reboot test that proves
  a live movement delta plus party and Pokedex state survive.
- 2026-07-28: The candidate three-run model comparison is not a valid
  measurement yet. Run 1 reached Route 103 but did not catch within 28m40s;
  runs 2 and 3 stopped immediately on Codex quota. Provider failures are now
  classified as invalid evidence and stop the series rather than lowering the
  game success rate.
- 2026-07-28: Automated stack review found and corrected two base-control
  races, four benchmark evidence defects, and two knowledge-integrity defects.
  Input ownership now lasts through child-process exit; moving-object blocks
  are rebuilt per observation; benchmark checkouts no longer depend on
  runner-only target files; artifact directories are reserved atomically;
  unexplained process exits remain harness errors; observation screenshots are
  counted; search filters generic words and weights repeated body evidence;
  and unresolved PokeAPI joins fail generation.
- 2026-07-28: Follow-up knowledge review found five more corpus defects. The
  source JSON Schema now accepts and requires its own `$schema`; unversioned
  modern item prices are omitted; Emerald uses Deoxys Speed Forme; mythical
  species are labeled distinctly; and species records include both forward
  and backward Emerald-era evolution methods and conditions.

## Session Log — 2026-07-28

### Done

- Implemented authoritative wasm32 save decoding, broader active-object
  observations, battle/visual action evidence, bounded navigation controls, a
  compact semantic CLI, prompt loop, provider-failure classification, and
  strict benchmark evidence.
- Implemented a general engine checkpoint and ordered atomic flash
  persistence. A rebuilt real WASM passed an independent checkpoint/reboot
  integration test against a copied live save.
- Verified the backend (248 tests, one opt-in live-save test skipped), package
  typecheck/lint, knowledge/build
  scripts, the exhaustive root `bun run verify` graph (217/217 tasks), and a
  clean Docker `smoke` build that rebuilt the patched WASM and passed both the
  ABI and in-image application checks.
- Completed a manual general-control playthrough through the first rival,
  Pokedex/Poke Ball acquisition, and a visible Poochyena catch.
- Published the three-PR git-spice stack as #1802, #1803, and #1805 and attached
  the rendered catch evidence to #1802. The first current-head Buildkite run
  exposed a cross-PR test dependency and router complexity regression; the
  test now lives with the compact CLI implementation in #1803, while #1802
  owns the shared semantic router. The exact test, lint, and Knip gates pass
  locally after that correction. Goal-process teardown tests now synchronize
  on the kill request instead of guessing that asynchronous work completes
  within 5 ms; the lifecycle suite passed 100/100 repeated cases.
- Addressed all eight initial actionable Codex review findings and five
  follow-up corpus findings across the stack with focused regression tests.
  The pinned knowledge generator completed against all four source revisions
  and reproduced 1,759 permissive plus 39 CC BY-NC-SA records.

### Remaining

- Monitor the corrected stack's replacement current-head Buildkite runs.
- Rerun three clean-copy candidate trials when Codex quota is available. Do
  not compare the current provider-invalid artifacts to the valid 0/3
  baseline.
- Run a production goal only after three consecutive local successes.

### Caveats

- No generalized runtime goal verifier or deterministic story solver will be
  introduced.
- The visual manual catch occurred exactly at the 30-minute timeout before the
  post-catch script updated the party/catch-event watcher, so it proves control
  capability but is not counted as a strict benchmark success.
- The valid baseline is 0/3 catches in 33m42s with 312 tool calls and 32.4M
  input tokens (estimated $5.07). Candidate performance remains unmeasured
  until provider capacity returns.

## Session Log — 2026-07-29

### Done

- Fixed benchmark catch evidence capture so the event frame and species remain
  immutable while party and Pokedex state settle for at most 1,800 frames or
  30 seconds.
- Prevented a later catch sample from supplying evidence for an older event by
  closing pending evidence against the preceding snapshot at each new-catch
  boundary.
- Added focused delayed-state, cross-catch contamination, frame-timeout,
  wall-timeout, and final-flush regressions.
- Captured and hashed the source save from one immutable byte read so later
  path changes cannot make the benchmark input disagree with its provenance.
- Kept observing for a late catch signal for at most 600 frames or 10 seconds
  after Codex exits, extended observation while event evidence is pending, and
  retained a 41-second hard wall cap.
- Added regressions for source-path replacement, the empty post-process signal
  grace, either-bound grace expiry, and pending-evidence hard-cap behavior.
- Verified all 313 backend tests, the 61 focused benchmark tests, backend
  typecheck, backend lint, and formatting.

### Remaining

- Publish the rewritten prompt/evaluation and knowledge stack heads.
- Re-run Buildkite and the fresh Codex review on the rewritten PR heads.
- Complete the repeated clean-copy model evaluation and production trial.

### Caveats

- This repair validates the harness timing behavior with deterministic tests;
  a clean-copy real-model benchmark remains the final acceptance measurement.
