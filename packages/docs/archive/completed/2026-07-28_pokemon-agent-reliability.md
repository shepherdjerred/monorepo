---
id: plan-pokemon-agent-reliability-2026-07-28
type: plan
status: complete
board: false
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
- [x] Publish and complete current-head verification for the semantic controls.
- [x] Implement early-prerequisite prompt and excerpt ranking.
- [x] Publish and complete current-head verification for the decision policy.
- [x] Replay the existing successful trace through the corrected telemetry.
- [x] Complete focused, real-WASM, Buildkite, and review verification for all
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
- 2026-07-29: Decision policy now requires compact-state inspection, an
  explicit immediate prerequisite, and one early targeted acquisition search
  before exploratory travel. Knowledge results rank and excerpt the passage
  with the strongest term coverage, proximity, and acquisition evidence.
