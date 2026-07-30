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

### 5. Approved reliability follow-up

Implement the remaining qualitative gaps as three additional git-spice layers.
The controls provide bounded, inspectable primitives; the model remains
responsible for game strategy and route choice.

1. **Benchmark truth**
   - Require the loaded save to reach a continued, input-ready overworld and
     remain spatially stable across consecutive samples before starting a run.
   - Parse every JSON value from chained `pokemonctl` output instead of treating
     an entire shell response as one value.
   - Count compact observations, full observations, tool-output characters,
     movement attempts, stops, repeated-position loops, and explicit ignored
     inputs exactly.
   - Replay the existing successful trace through the corrected parser. Do not
     spend model quota on repeat trials in this phase.
2. **Semantic gameplay**
   - Make compact observations decision-complete for normal play while keeping
     `observe --full` byte-for-byte diagnostic.
   - Add `map exits` plus bounded `navigate --exit <id>`. The command may inspect
     and traverse one selected current-map exit; it must not choose a route or
     chain maps.
   - Add named battle actions for move, run, item, switch, and target selection.
     Each action executes the caller's explicit choice and settles at the next
     authoritative decision point; it must not choose battle strategy.
3. **Decision policy**
   - Teach the agent to inspect compact state first, identify prerequisites
     before moving, and issue one targeted knowledge query early when the
     acquisition path is unknown.
   - Rank knowledge excerpts by coverage, proximity, and acquisition evidence
     so the decisive reward paragraph is returned rather than a prior incidental
     mention.
   - Prefer semantic exit and battle actions, one gameplay-changing operation
     per shell command, and the settled action result over a redundant appended
     observation.

Acceptance is focused package tests, typecheck, lint, staged-file checks, a
rebuilt real-WASM ABI/smoke gate for C observation changes, CLI recordings for
the visible semantic controls, current-head Buildkite, and clean review threads
for every stack layer. Repeat model measurements and Kubernetes mutation remain
deferred by explicit direction.

## Remaining

- [x] Implement and verify the observation/control foundation.
- [x] Implement and verify the compact prompt and benchmark harness.
- [x] Implement and verify the knowledge corpus, retrieval, and skills.
- [x] Publish the restacked #1803/#1805 heads and record replacement CI/review.
- [x] Implement benchmark-truth corrections.
- [x] Implement compact semantic exits and named battle actions.
- [ ] Publish and complete current-head verification for the semantic controls.
- [ ] Implement and publish early-prerequisite prompt and excerpt ranking.
- [x] Replay the existing successful trace through the corrected telemetry.
- [ ] Complete focused, real-WASM, Buildkite, and review verification for all
      new stack layers.

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
- 2026-07-28: The replacement benchmark review found two invalid-measurement
  paths. An unexplained nonzero Codex exit now becomes a harness error before
  evaluation while retaining its exit code in the artifact. The runner now
  resolves both target and runner Git top-level directories, then rejects
  symlink-resolved output and runtime-overlay paths inside either worktree
  before reserving them.
- 2026-07-28: The next exact-head review found two end-of-run consistency
  defects. Catch eligibility now ends at the emulator frame captured with the
  final live snapshot, so the last post-exit watcher poll counts without
  admitting later contamination. Path-like Codex binary arguments are
  normalized against the operator's original working directory before the
  worker switches to its runtime overlay; bare PATH commands remain unchanged.
- 2026-07-29: Approved the qualitative reliability follow-up for gaps 2 through 6. Repeat paid measurements are deferred. Navigation is bounded to inspecting
  and traversing a caller-selected current-map exit, battle commands execute
  named caller choices, and neither capability may become a deterministic
  solver.
- 2026-07-29: The corrected parser replayed the existing successful candidate
  trace without another model run. It reports 141 movement actions, 54 stops,
  52 repeated-position loops, zero explicit ignored inputs, 44 compact
  observations, 233 full observations, and 721,752 tool-output characters.
- 2026-07-29: Semantic gameplay now exposes decision-complete compact state,
  authoritative stable current-map exit IDs, bounded traversal of one
  caller-selected exit, and exact-name battle actions that execute only the
  caller's move, item, switch, run, or target choice.

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
- Verified the combined backend (319 tests, zero failures or skips), all 30
  knowledge/build script tests, package typecheck/lint, the exhaustive
  root `bun run verify` graph (217/217 tasks), and a clean Docker `smoke` build
  that rebuilt the patched WASM, passed both mandatory real-emulator ABI and
  independent checkpoint/reboot tests, and passed the in-image application
  check. The resulting local smoke image
  manifest is
  `sha256:3790bb0257f910e89812995845a78fa650b9621484f239761be91ba7be84ece5`.
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
  generator, runtime, and 1,803 records preserve every contributing source
  structurally.
- Closed the replacement Buildkite security failure by upgrading
  `golang.org/x/text` from v0.37.0 to v0.39.0 in the base PR. The provider's
  tests, vet, and golangci-lint pass, and the CI-equivalent Trivy scan reports
  zero HIGH/CRITICAL vulnerabilities across all five detected dependency
  manifests.
- Closed the final two benchmark review findings. Unclassified nonzero Codex
  exits cannot reach the catch evaluator, their harness-error artifacts retain
  the actual exit code, and target/runner Git-root containment protects both
  benchmark output and runtime overlays, including symlink aliases.
- Closed the next two exact-head benchmark findings. Catch-event correlation
  uses an emulator-frame upper bound coupled to final evidence capture, and a
  relative path-like Codex binary resolves identically during preflight and
  worker execution.
- Closed the next three knowledge review findings. Acquisition-intent ranking
  now puts the HM04 award passage first for `how to get strength`; Wurmple's
  hidden personality-value branch is represented with pinned PokeAPI and
  pokeemerald provenance; and move-history reconstruction selects each field's
  Emerald-era value independently, including Vine Whip at 35 power and Giga
  Drain at 60.
- Closed the following Unicode retrieval finding. NFKD search normalization
  removes combining marks before punctuation folding, so `Pokéblock Case`
  remains a single semantic token and ranks the actual case record rather than
  the unrelated Block move.
- Closed the late navigation review finding. A failed step remains learned for
  normal planning, but `no-route` gets one bounded revalidation against current
  NPC occupancy and authoritative static collision, allowing a transiently
  occupied corridor tile to recover while all retries still consume
  `maxSteps`.
- Reconciled the stack after #1802 merged, closed the transient duplicate
  #1833, and restacked #1803/#1805 onto `main`. Replacement Buildkite #7140
  and #7141 passed every authoritative lane on the exact rewritten heads;
  fresh Codex reviews found no major issues, every current and outdated
  GraphQL thread is resolved, and GitHub reports both PRs clean and mergeable.

### Remaining

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
- Added reward acquisition vocabulary and evidence-position excerpts so
  `how to get fly` ranks the HM02 reward passage first and shows the
  acquisition text.
- Added an Emerald-specific HM06 acquisition record from the pinned
  `MauvilleCity_House1` gift event. The exact query
  `where to get HM06 Rock Smash` now ranks that record first and identifies the
  Rock Smash Dude's house in Mauville City.
- Made every nested source-manifest object closed in the language-neutral JSON
  Schema and added draft-2020 validation regressions for typos inside a source
  object and a Bulbapedia page pin.
- Restricted acquisition-evidence bonuses to explicit acquisition language so
  an ordinary location query such as `where is Route 101` ranks the Route 101
  world record rather than unrelated randomizer reward metadata, while
  `where to get HM06 Rock Smash` retains acquisition intent through `get`.
- Verified all 313 middle-layer and 319 composed-top backend tests, the 61
  focused benchmark tests, all 30 knowledge/build script tests, backend and
  scripts typecheck/lint, and formatting.
- Completed hosted verification on the then-current code-bearing stack heads:
  Buildkite #7123 for #1802, #7130 for #1803, and #7132 for #1805 passed all
  authoritative lanes. Fresh exact-head Codex results were clean, every
  GraphQL review thread was resolved, GitHub reported each PR clean and
  mergeable, and direct merge-tree checks passed for the stacked PRs.
- Replaced PokeAPI's historical Hidden Power sentinel (`Normal`, power 1,
  physical) with the pinned Emerald mechanics: an IV-derived 16-type range,
  power 30-70, and a physical/special category derived from the resulting
  Generation III type.
- Filtered battle moves through the pinned PokeAPI Generation III type-index
  table after historical reconstruction. This removed all 18 side-game
  Shadow-type moves without a fragile name list while retaining the legitimate
  Ghost-type Shadow Ball and Shadow Punch records.
- Regenerated 1,744 permissive plus 41 CC BY-NC-SA records and verified all 33
  knowledge/build script tests, all 319 backend tests, and both packages'
  typecheck and lint tasks.
- Reconciled the stack after #1802 merged, closed the transient duplicate
  #1833, and restacked the surviving PRs onto `main`. Buildkite #7140 passed
  for exact #1803 head `2014afba23`, and #7141 passed for exact #1805 head
  `69477a3d91`; both fresh Codex reviews were clean, all review threads are
  resolved, and both PRs are clean and mergeable.

### Remaining

- Run two more consecutive clean-copy candidate trials from the same immutable
  source save. The first valid candidate trial succeeded, but one run does not
  establish repeatability.
- Fix benchmark boot preflight so it requires a continued, input-ready game
  rather than accepting a title/attract-state snapshot with loaded save data.
- Parse every JSON line from chained `pokemonctl` command output so movement,
  movement-stop, repeated-position-loop, and ignored-input telemetry is
  trustworthy.
- Reduce navigation and context cost: the successful run needed 287 tool calls
  and 35.5M input tokens, frequently requested `observe --full`, guessed map
  targets, and crossed encounter grass repeatedly.
- Run a production goal only after three consecutive local successes.

### Caveats

- Candidate commit `0665aa9991fd68c9cc62c0608acd5e1bbcac84f0`
  completed one strict clean-copy catch benchmark successfully in 25m14s:
  Wurmple species `290` was correlated across the post-start catch event,
  post-event state, final live state, and persisted save.
- The successful run used 287 tool calls, 29 screenshots, eight knowledge
  queries, 35.5M input tokens (98.5% cached), and an estimated $4.31. The
  movement telemetry fields are invalid for this run because their parser
  missed chained JSON outputs.

## Session Log — 2026-07-29 (catch benchmark)

### Done

- Copied the live Kubernetes Emerald flash without mutating the PVC and
  verified its exact 131,072-byte size and SHA-256
  `34672c1bf24ff9ddb8b13bb942c1fdae670afad881eb01e928e9ee07b48e73a2`.
- Ran the full candidate at exact commit
  `0665aa9991fd68c9cc62c0608acd5e1bbcac84f0` with candidate WASM SHA-256
  `2444d913c9a22d18e4aa8fe4881d52c5dbc717e76df44e77a5eb4d03f5b326bb`,
  exact goal `get me a pokeman`, `gpt-5.6-luna`, and medium reasoning.
- Observed the agent leave Birch's lab, train Torchic, recover from an
  incorrect prerequisite hypothesis, win the Route 103 rival battle, return
  for the Pokédex and five Poké Balls, and catch Wurmple.
- Passed the independent strict evaluator with catch-event, post-event,
  live-party/Pokédex, persisted-save, exact-species, save-ordering, and
  128-KiB save-integrity evidence.
- Stopped the automatically started second trial after the user accepted the
  qualitative behavior, avoiding an unrequested additional hour and model
  cost.
- Identified benchmark boot-state and chained-output telemetry defects, plus
  high navigation/tool/context cost, as the next concrete improvement targets.

### Remaining

- Complete two more consecutive clean-copy successes before claiming reliable
  candidate performance or running the production goal.
- Fix and verify the boot-state and movement-telemetry defects.
- Reduce unnecessary full observations, map-target guesses, and wild-encounter
  overhead without introducing a deterministic quest solver.
- Merge/deploy the prompt and knowledge PRs before production comparison; the
  current Kubernetes image contains only the merged semantic-controls layer.

### Caveats

- The valid comparison is baseline `0/3` versus candidate `1/1`; this
  demonstrates capability, not a statistically reliable success rate.
- Candidate run artifacts are ephemeral under
  `/tmp/pokemon-catch-measurement.pk4fVl/candidate-0665aa9/`.
- The interrupted second run is not a valid model measurement and must not be
  included in the success-rate denominator.

## Session Log — 2026-07-29 (benchmark truth)

### Done

- Tightened benchmark boot readiness to require a continued, input-ready,
  stable overworld with initialized game, snapshot, spatial, and world evidence
  on two consecutive emulator frames.
- Parsed every structured JSON line from chained command output and counted
  movement, stops, loops, and each explicit ignored-input occurrence.
- Added compact/full observation invocation and exact completed tool-output
  character telemetry to run artifacts and summaries.
- Replayed the existing successful trace with corrected totals: 141 movement
  actions, 54 stops, 52 loops, 44 compact observations, 233 full observations,
  and 721,752 output characters.
- Verified all 323 backend tests, typecheck, and lint.

### Remaining

- Publish the benchmark-truth stack layer and complete its current-head
  Buildkite and review verification.
- Implement the compact observation, selected-exit navigation, named battle
  actions, prerequisite prompt, and knowledge-excerpt layers above it.

### Caveats

- Observation totals count explicit `pokemonctl observe` invocations in command
  text; tool-output characters count completed aggregated output exactly once.
- The replay is corrected analysis of an existing run, not a new reliability
  measurement.

## Session Log — 2026-07-29 (semantic gameplay)

### Done

- Expanded compact observations with movement, progression, party, inventory,
  and battle decision data while preserving byte-for-byte `--full` output.
- Added engine-backed current-map connection/warp discovery and bounded
  traversal of exactly one caller-selected exit.
- Added exact-name move/item catalogs and explicit move, item, switch, run,
  and target controls that reject unavailable choices before input.
- Passed 92 focused backend and generator tests covering the observation ABI,
  exit interruption, named battle selection, compact output, and prior control
  behavior.

### Remaining

- Rebuild and run the mandatory real-WASM ABI gate once the local OrbStack
  Docker service responds.
- Publish the semantic-control draft PR and complete current-head Buildkite and
  review verification.
- Implement and publish the early-prerequisite prompt and knowledge passage
  ranking as the final code layer.

### Caveats

- The host-only WASM build reached patch application but lacks `pkg-config` and
  `png.h`; only the Docker toolchain or Buildkite is authoritative for the C
  integration.
- OrbStack reported itself running but its Docker socket did not answer
  `docker info`; no engine compile result has been inferred from that host
  runtime failure.
- Repeat paid model measurements remain explicitly deferred.

## Session Log — 2026-07-29 (semantic gameplay review fixes)

### Done

- Triaged the five current hosted review findings on exact PR #1847 head
  `3ac341da933615ea3b3721e4afcb14c330cccbb4`.
- Added generated move-target and battle-item interaction metadata from the
  pinned Emerald source, with fail-fast parsing and catalog tests.
- Confirmed the Shift submenu after voluntary party selection; required and
  validated item recipients; rejected unsupported, unavailable, and
  trainer-ineligible items before input; and rejected explicit move targets
  that the engine cannot expose.
- Fingerprinted the complete WASM patch series, reset and reapplied changed
  source patches while preserving cached build tools, and verified every
  required observation-v3 bridge symbol before compilation.
- Rebuilt the real WASM and passed all 349 backend tests, all 50 script tests,
  and package-scoped TypeScript and ESLint checks.
- Published the fix to PR #1847, restacked its decision-policy child PR #1848
  with git-spice, and requested fresh hosted reviews for both new heads.

### Remaining

- Complete current-head Buildkite and hosted review verification.

### Caveats

- The rebuilt WASM asset is ignored and remains a local verification artifact;
  CI rebuilds it from the fingerprinted patch series.
- Repeat paid model measurements remain explicitly deferred.

## Session Log — 2026-07-29 (battle eligibility review fixes)

### Done

- Added an observation-v4 engine contract for per-move limitations and
  voluntary-switch eligibility, matching Emerald's Disable, Torment, Taunt,
  Imprison, Encore, Choice Band, trapping-status, Battle Arena, Shadow Tag,
  Arena Trap, and Magnet Pull rules.
- Added a pure WASM preflight query for party-targeted battle medicine and
  wired move, switch, and item actions to reject invalid choices before sending
  controller input.
- Kept Revive-compatible fainted party targets eligible for the authoritative
  item query while retaining alive-only validation for voluntary switches.
- Rebuilt the real WASM, invoked the new export through the runtime binding,
  and passed focused semantic-control tests plus backend/common package
  typecheck and lint.

### Remaining

- Update the runtime Pokemon battle and world skills for the new semantic
  observation fields in the next review cycle.
- Complete replacement Buildkite and hosted-review verification for PRs #1847
  and #1848.

### Caveats

- Party-targeted HP, revive, major-status, confusion, and infatuation medicine
  use the engine-owned item-effect table. PP medicine remains rejected because
  the semantic item action does not accept a move choice.
- The existing Buildkite script-coverage failure is queued for a separate
  remediation cycle and is not bypassed by these changes.

## Session Log — 2026-07-29 (semantic runtime skills)

### Done

- Updated the runtime `pokemon-battle` skill with live eligibility fields and
  the exact semantic move, item, switch, run, and target command forms.
- Updated the runtime `pokemon-world` skill with engine-authored exit
  discovery, stable IDs, selected-exit traversal, and same-map navigation.
- Regenerated both OpenAI skill metadata files and passed the skill schema and
  focused Markdown validation.

### Remaining

- Complete replacement Buildkite and hosted-review verification for PRs #1847
  and #1848.

### Caveats

- The existing script-coverage failure remains queued for its separate
  remediation cycle.
- PR #1848 retains its separate passage-coverage-versus-metadata review
  finding; this #1847 documentation cycle does not alter ranking behavior.

## Session Log — 2026-07-29 (battle decision eligibility)

### Done

- Added explicit forced-replacement support for Emerald's input-ready Send Out
  party decision without weakening voluntary-switch trapping checks.
- Rejected Run in trainer battles before controller input and limited trapping
  abilities in the WASM switch preflight to present, living opponents.
- Rebuilt the real WASM and passed focused control, patch-series, symbol smoke,
  backend/common typecheck, and backend/common lint verification.
- Published the review fixes to PR #1847 and restacked and published its child
  PR #1848.

### Remaining

- Complete current-head Buildkite and hosted-review verification for PRs #1847
  and #1848.
- Address script coverage in its separate queued cycle.

### Caveats

- Forced replacement is admitted only for engine party action `SEND_OUT`; item
  targeting and other party decisions remain invalid for `battle switch`.
- The rebuilt WASM asset is ignored and remains a local verification artifact.
- PR #1848's separate passage-coverage-versus-metadata finding is unchanged.

## Session Log — 2026-07-29 (WASM build coverage)

### Done

- Refactored the WASM build entrypoint into typed, injectable orchestration
  units without changing its executable command.
- Bound source-cache identity to the upstream commit, ordered patch contents,
  and required bridge symbols, and refused to bless incomplete patched source.
- Validated compiled artifact existence, minimum size, WASM header, and copied
  size before running generated-data updates.
- Added behavior tests for toolchain failures, subprocess and patch failures,
  clone/fetch/build orchestration, cache reuse and invalidation, bridge
  completeness, artifact rejection, and generator ordering.
- Raised exact package script coverage from 87.18% functions and 72.36% lines
  to 100% functions and 98.39% lines, then rebuilt and smoke-tested the real
  WASM.

### Remaining

- Complete replacement Buildkite and hosted-review verification for PRs #1847
  and #1848.

### Caveats

- The one-mebibyte artifact floor is a truncation guard, not a substitute for
  the real-WASM symbol and snapshot smoke.
- The rebuilt WASM asset remains ignored and is not committed.

## Session Log — 2026-07-29 (battle action preflight)

### Done

- Reused the pending move's generated target mode to reject illegal standalone
  target selections before controller input.
- Added read-only engine eligibility exports for direct battle-item effects and
  deterministic Run restrictions, including stat caps, Guard Spec, trapping
  statuses, Ingrain, Shadow Tag, Arena Trap, and Magnet Pull.
- Switched `pokemonctl battle item --party-slot` to strict integer parsing so
  fractional and trailing-text values fail before an HTTP request.
- Rebuilt the real WASM and passed the symbol/reboot smoke, focused
  zero-input controller tests, package typecheck and lint, and exact script
  coverage at 100% functions and 98.39% lines.

### Remaining

- Complete current-head Buildkite and hosted-review verification for PRs #1847
  and #1848.

### Caveats

- Normal wild-battle speed escape odds remain selectable; Run preflight rejects
  only deterministic prevention and preserves Emerald's Smoke Ball and Run Away
  exceptions.
- The rebuilt WASM asset is ignored and remains a local verification artifact.
- PR #1848's two passage-ranking findings are unchanged.

## Session Log — 2026-07-29 (allied battle targets)

### Done

- Replaced one-direction target cycling with position-aware navigation over
  Emerald's target ring.
- Added focused controller coverage proving horizontal opponent targeting uses
  Left and cross-side allied targeting uses Down before confirming the choice.
- Passed the focused battle/controller tests plus backend typecheck and lint.

### Remaining

- Publish the #1847 fix, restack and publish #1848, and complete current-head
  Buildkite and hosted-review verification for both pull requests.

### Caveats

- The Enigma Berry review finding on #1847 remains unchanged.
- PR #1848's two passage-ranking findings remain unchanged.
- No WASM rebuild is required because this change uses existing decoded
  battler-position observations and does not change engine exports.

## Session Log — 2026-07-29 (Enigma Berry battle effects)

### Done

- Classified the dynamic Enigma Berry battle handler as party-targeted so its
  live e-Reader effect reaches the existing engine eligibility query.
- Added focused coverage for both an engine-approved Enigma Berry effect and a
  genuinely ineffective live effect rejected before controller input.
- Regenerated the pinned item interaction catalog and passed focused tests,
  typecheck, and lint.

### Remaining

- Publish the #1847 fix, restack and publish #1848, and complete current-head
  Buildkite and hosted-review verification for both pull requests.

### Caveats

- Enigma Berry HP and status restoration uses the party-item action; dynamic
  PP-restoring and X-item effects remain unsupported by this action shape.
- No WASM rebuild is required because the existing party-mon eligibility export
  already reads the save's live Enigma Berry effect.
- The other #1847 route finding and all #1848 findings remain unchanged.

## Session Log — 2026-07-29 (live battle move state)

### Done

- Replaced controller-buffer move decoding with authoritative per-battler move
  IDs, current PP, and PP-Up-derived maximum PP from Emerald's live battle
  state.
- Preserved the existing live move-limitation query for Disable, PP depletion,
  Torment, Taunt, Imprison, Encore, and Choice Band restrictions.
- Added first-turn, later-turn stale-order, absent-move, and disabled-move
  regressions, plus a source-contract test for the live engine fields.
- Rebuilt the real WASM and passed focused tests, the real-WASM ABI/reboot
  smoke, typecheck, and lint.

### Remaining

- Publish the #1847 fix, restack and publish #1848, and complete current-head
  hosted-review verification for both pull requests.

### Caveats

- The observation ABI remains version 4 and 144 bytes; only the source of its
  existing move records changed.
- The rebuilt WASM asset is ignored and remains a local verification artifact.
- The #1847 warp finding and all #1848 findings remain unchanged.

## Session Log — 2026-07-29 (selected-exit warp safety)

### Done

- Added every nonselected step-activated warp trigger to the selected exit
  route's permanent blocked tiles.
- Preserved the caller-selected warp trigger as a valid activation endpoint in
  both initial planning and transient-blocker revalidation.
- Added focused coverage proving a corridor through a competing automatic warp
  returns `no-route` without input while a valid selected warp still activates.
- Passed focused controller tests plus backend typecheck and lint.

### Remaining

- Publish the #1847 fix, restack and publish #1848, and complete current-head
  hosted-review verification for both pull requests.

### Caveats

- Directional warp-arrow triggers are not added to the automatic-warp block set;
  they activate only through their required directional input.
- The forced-replacement settling finding on #1847 and all #1848 findings
  remain unchanged.
- Shared-cache Buildkite retries and cache mutations remain explicitly deferred.

## Session Log — 2026-07-29 (forced-replacement settlement)

### Done

- Reused the forced-replacement rule's exact input-ready `SEND_OUT` predicate
  when settling completed battle commands.
- Applied the predicate to move confirmation as well as the shared
  post-command settlement path used by items, switches, targets, and Run.
- Added focused regressions proving a ready forced replacement completes
  immediately while transient and non-replacement party states time out.
- Passed the focused controller test file plus backend typecheck and lint.

### Remaining

- Await current-head hosted-review responses for PRs #1847 and #1848.

### Caveats

- Only an input-ready party action with the engine's `SEND_OUT` action code is
  settled; non-input-ready and other party decisions remain unsettled.
- The Struggle finding on #1847 and all #1848 findings remain unchanged.
- Shared-cache Buildkite retries and cache mutations remain explicitly deferred.

## Session Log — 2026-07-29 (forced Struggle)

### Done

- Traced Emerald's action-selection path and confirmed it checks all four move
  limitations before opening the move menu, then assigns Struggle itself.
- Routed an explicit exact-name Struggle request through Fight without
  fabricating or selecting a live move slot.
- Preserved fail-fast rejection for Struggle when any move remains legal and
  for an individually exhausted or disabled move alongside a legal alternative.
- Added focused controller and CLI regressions and passed backend tests,
  typecheck, and lint.

### Remaining

- Await current-head hosted-review responses for PRs #1847 and #1848.

### Caveats

- Struggle has no caller-selected target; Emerald chooses its target as part of
  the forced engine action.
- No WASM rebuild is required because the existing live move limitation bits
  already match Emerald's `AreAllMovesUnusable` decision.
- The directional-warp `U-Zlx` finding surfaced after publication and remains
  untouched.
- All #1848 findings remain unchanged.
- Shared-cache Buildkite retries and cache mutations remain explicitly deferred.

## Session Log — 2026-07-29 (directional warp exclusion)

### Done

- Replaced the competing-warp tile blacklist with directed movement-edge
  exclusions derived from each warp's engine-reported activation.
- Blocked all four inbound edges for nonselected step warps and only the
  required inbound edge for nonselected directional warps.
- Added focused regressions proving a triggering directional edge returns
  `no-route` without input while the same tile remains traversable from a safe
  side.
- Passed focused controller tests plus backend typecheck and lint.

### Remaining

- Await current-head hosted-review responses for PRs #1847 and #1848.

### Caveats

- Unsupported warps contribute no blocked edge because selected-exit navigation
  cannot activate them.
- No WASM rebuild is required because directional activation already exists in
  the topology ABI.
- The same-map warp traversal `U-gat` finding surfaced after publication and
  remains untouched.
- All #1848 findings remain unchanged.
- Shared-cache Buildkite retries and cache mutations remain explicitly deferred.

## Session Log — 2026-07-29 (same-map warp traversal)

### Done

- Recognized a selected same-map warp as `exit-traversed` when the settled
  observation matches its engine-exported destination landing.
- Preserved trigger-only and genuine activation-no-effect outcomes with focused
  controller regressions.
- Passed the focused controller suite, backend typecheck, changed-file ESLint,
  and changed-file Prettier checks.

### Remaining

- Await current-head Buildkite and hosted-review responses for PRs #1847 and
  #1848.

### Caveats

- Same-map traversal is reported only from a resolved exported landing that
  differs from the trigger; an unresolved dynamic destination is not guessed
  from unrelated state changes.
- The four #1848 findings remain unchanged.
- Shared-cache Buildkite retries and cache mutations remain explicitly deferred.
