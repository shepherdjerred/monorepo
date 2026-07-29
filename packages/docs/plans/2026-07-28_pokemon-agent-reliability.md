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
- 2026-07-28: Final lifecycle review found that accepted control requests
  could outlive their goal, starts could overlap timeout teardown, Discord
  could acknowledge lease-rejected input, startup errors could be
  misclassified as provider failures, and the benchmark worker could return
  before history persistence. Goal-scoped control gates now drain before lease
  release, teardown rejects new starts, lease conflicts are typed and reported
  to the user, only explicit provider startup failures are classified, and
  each run uses an isolated helper directory and waits for its history record.
- 2026-07-28: Final corpus review found two more unversioned PokeAPI fields.
  Current base-experience values are now omitted instead of being presented as
  Emerald data, and friendship evolutions retain the version-supported
  high-friendship condition without presenting the current numeric threshold
  as historical data.
- 2026-07-28: Final control review found three misleading observation paths.
  Observation ABI v2 now selects the battler whose actual local-player handler
  is awaiting action, move, target, or yes/no input, so AI/link partners and a
  completed first battler cannot masquerade as readiness. Dialog visibility and
  input readiness are separate engine facts backed by text-printer and script
  wait state, so `advance` refuses cutscenes, auto-scroll, and text that is still
  printing. `observe` is compact by default while `observe --full` preserves the
  canonical diagnostic payload.
- 2026-07-28: The final benchmark review rejected full-party source saves so a
  catch always has independent party-identity evidence, restricted movement
  telemetry to directional field actions, and added a discoverable operator
  runbook plus dynamic benchmark skill. The first replacement image build also
  found that the installed standalone CLI omitted its formatter module; the
  runtime image now installs both files and passes the complete in-image smoke.
- 2026-07-28: Replacement review hardened the semantic contract again. The
  base prompt now teaches semantic controls first and reserves raw input for
  recovery, `interact` requires a stable ready overworld before and after
  turning, and external Bag/Party selectors provide authoritative battle-input
  readiness.
- 2026-07-28: The benchmark now runs historical targets through a runner-owned
  runtime overlay rather than adding new fields to their configuration. Its
  success oracle independently parses the raw 128 KiB flash image, validates
  every sector signature, ID, counter, checksum, and layout, handles the exact
  Emerald counter rollover, and requires both runner and target provenance to
  be clean.
- 2026-07-28: Final knowledge correction removed the remaining unversioned
  PokeAPI capture-rate field and added the empty-party requirement for
  Shedinja from the pinned pokeemerald source. The corpus now reproduces 1,760
  permissive and 39 CC BY-NC-SA records.
- 2026-07-28: The current-head review gate surfaced five control/CLI threads
  and two cross-layer integrity threads. Three pointed at code already fixed
  but still-unresolved discussions; the remaining changes ensure every
  attempted navigation step consumes the caller's bound, movement stays in the
  authoritative overworld, a direction press that moves the player ends
  `interact` before A, the advertised `advance` command runs through the real
  CLI, benchmark output cannot be placed in or symlinked into its target
  checkout, and generic Nincada/Shedinja records preserve the pinned level-20
  and empty-party rule.
- 2026-07-28: The next review cycle found that MediaWiki TextExtracts could
  return current prose even when revision metadata was pinned. Walkthrough
  generation now parses rendered content with `oldid=<revision>`, rejects
  revision/title drift, and deterministically extracts article prose from the
  coupled response. It reproduced 41 licensed records covering all 22 pinned
  revisions while preserving the HM03 search regression.
- 2026-07-28: The Docker ABI review also found that checkpoint/reboot coverage
  still depended on an operator save and skipped in the mandatory image gate.
  The test now creates deterministic blank flash, drives the real new-game
  flow, moves, checkpoints, and verifies spatial, party, Pokedex, and decoded
  save equality through an independently initialized emulator. The local and
  Docker executions both pass two tests with zero skips.
- 2026-07-28: The following current-head reviews each found one remaining
  cross-layer defect. Title-screen SaveBlock1 ciphertext is now withheld until
  SaveBlock2 has an EOS-terminated initialized player name, while a legitimate
  zero encryption key still decodes. Benchmark overlays and production images
  now carry and verify the same `AGENTS.md` and `.agents` instruction surface.
  Knowledge records now require non-empty structured `sources`; generic
  Nincada and Shedinja records attribute both PokeAPI and the pinned
  pokeemerald mechanic without losing the empty-party requirement.
- 2026-07-28: Replacement Buildkite security scanning found
  CVE-2026-56852 in `golang.org/x/text` v0.37.0. The base stack layer now uses
  v0.39.0 and its compatible `golang.org/x/*` dependency set. Go tests, vet,
  golangci-lint, and the exact repository Trivy HIGH/CRITICAL scan all pass
  locally with zero findings.

## Session Log — 2026-07-28

### Done

- Implemented authoritative wasm32 save decoding, broader active-object
  observations, battle/visual action evidence, bounded navigation controls, a
  compact semantic CLI, prompt loop, provider-failure classification, and
  strict benchmark evidence. The final evaluator independently validates raw
  flash signatures, sector identity, save counters, checksums, layout, and
  catch persistence without importing the target emulator.
- Implemented a general engine checkpoint and ordered atomic flash
  persistence. A rebuilt real WASM passed an independent checkpoint/reboot
  integration test against a copied live save.
- Verified the combined backend (301 tests, zero failures or skips), all 23
  knowledge/build script tests, package typecheck/lint, the exhaustive
  root `bun run verify` graph (217/217 tasks), and a clean Docker `smoke` build
  that rebuilt the patched WASM, passed both mandatory real-emulator ABI and
  independent checkpoint/reboot tests, and passed the in-image application
  check. The resulting local smoke image
  manifest is
  `sha256:55da51c5dcaaf78978ff593426fcfc09cf5da01f69adde6acc2d93805a875e7b`.
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
- Addressed the final seven control and benchmark lifecycle findings. Control
  requests now carry and enforce goal identity, terminal paths drain accepted
  requests before releasing input, teardown is exclusive, Discord reports
  lease denial without a false acknowledgement, benchmark helpers are
  per-run, history persistence is awaited, and unknown startup exceptions
  remain harness failures.
- Removed unversioned base-experience values from species records and
  normalized every Emerald friendship evolution to a nonnumeric
  high-friendship condition. The pinned generator reproduced 1,759 permissive
  and 39 CC BY-NC-SA records, and all 19 generator/corpus tests pass.
- Replaced heuristic double-battle and dialog readiness with authoritative
  engine hooks, bumped the packed observation ABI and public observation schema
  to v2, and unified compact/full CLI formatting across observations and action
  outcomes. The rebuilt 13.4 MiB WASM passes the mandatory Docker ABI boot test.
- Hardened the benchmark source-save preflight around a complete active
  14-sector slot and a required empty party position, removed menu/battle
  controls from movement-loop telemetry, documented the operator workflow in
  `AGENTS.md`, and added the dynamically loaded `pokemon-goal-benchmark` skill.
- Fixed the runtime image to install the semantic CLI formatter beside
  `pokemonctl`; the exact previously failing Docker `smoke` target now passes.
- Addressed the latest nine actionable review findings: semantic-first prompt
  guidance, stable-overworld interaction guards, authoritative Bag/Party input
  states, historical-target runtime overlays, an independent persisted-save
  oracle, strict flash integrity and rollover handling, clean runner
  provenance, removal of unversioned capture rates, and the pinned Shedinja
  empty-party condition.
- Addressed the replacement review cycle: navigation attempts are strictly
  bounded even when movement fails, movement aborts outside the overworld,
  interaction never follows an accidental step with A, `pokemonctl advance` is
  registered and integration-tested, benchmark output containment resolves
  symlink aliases before artifact creation, and generic species retrieval
  carries the pinned Shedinja creation requirements.
- Closed the final two review defects: Bulbapedia prose is fetched and
  validated from the exact pinned revision rather than pairing old metadata
  with current text, and the mandatory Docker ABI gate now proves checkpoint
  persistence through a deterministic new game and independent reboot without
  requiring `POKEMON_LIVE_SAVE_PATH`.
- Closed the next three current-head review defects: encrypted save details
  fail closed until SaveBlock2 is initialized without rejecting zero-key new
  games; benchmark and deployed Codex instruction/skill surfaces have an
  enforced Docker parity test; and the language-neutral knowledge schema,
  generator, runtime, and 1,801 records preserve every contributing source
  structurally.
- Closed the replacement Buildkite security failure by upgrading
  `golang.org/x/text` from v0.37.0 to v0.39.0 in the base PR. The provider's
  tests, vet, and golangci-lint pass, and the CI-equivalent Trivy scan reports
  zero HIGH/CRITICAL vulnerabilities across all five detected dependency
  manifests.

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
