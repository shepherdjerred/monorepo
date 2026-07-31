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
- [ ] Implement and verify the knowledge corpus, retrieval, and skills.
- [ ] Complete repeated local evaluation and iterate on failures.
- [ ] Publish the review-ready stack and record CI/live verification.

## Comment Log

- 2026-07-28: Approved for implementation. Controls and prompt are the
  critical path; skills are explicitly secondary.

## Session Log — 2026-07-28

### Done

- Captured the approved implementation plan and source/licensing decisions.

### Remaining

- Execute, verify, publish, and measure the implementation.

### Caveats

- No generalized runtime goal verifier or deterministic story solver will be
  introduced.

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
