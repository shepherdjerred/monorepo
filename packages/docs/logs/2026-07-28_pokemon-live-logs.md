---
id: log-pokemon-live-logs-2026-07-28
type: log
status: in-progress
board: false
---

# Pokemon Live Log Investigation

## Scope

Inspect the live Discord Plays Pokemon workload and its recent logs through
Kubernetes and Loki/Grafana, checking S3-compatible storage only where it is
relevant to the observed log path. Reproduce the failed goal locally against a
copy of the same save to separate model behavior from controller limitations,
then manually complete the goal to identify the missing observations and
controls from a successful trace.

## Findings

- The live `pokemon` Deployment was healthy at inspection time: `1/1`
  available, current image `2.0.0-6690`, current pod running with zero restarts,
  bound save PVC, and no pod events.
- Loki retained both recent play sessions:
  - July 26, 2026, 2:19:14–2:28:24 PM PDT (9m 10s)
  - July 27, 2026, 1:19:51–1:37:26 PM PDT (17m 35s)
- Grafana's `stream_active` metric was active during both sessions. Over the
  72-hour investigation window, the aggregate increases for
  `emulator_frame_hook_errors_total`, `notification_send_errors_total`,
  `flash_save_load_invalid_total`, and `emulator_loop_resync_total` were all
  zero.
- Both sessions ended with `reason: userStop`; neither ended because the pod or
  emulator crashed.
- Both stops then hit the same cleanup exception:
  `streamer destroy failed null is not an object (evaluating
'this.connection.readyState')`. The stack reaches the bare selfbot-client
  `destroy()` in
  `packages/discord-plays-core/src/stream/game-streamer-base.ts`. The exception
  is caught by the Pokemon driver, so the session still records `session
stopped`, but the cleanup call itself fails.
- The two affected runtime versions were `6347` and `6529`. The current
  deployment is `6690`, but current source still uses the same unguarded
  `destroy()` path, so the next user stop can reproduce the error.
- The July 27 `error: undefined` line is a separate logging defect, not an
  application failure. The Discord message handler logs the value `undefined`
  at error level when a message in the active play channel does not parse as a
  controller chord.
- SeaweedFS contained seven matching LLM archive objects: one from July 26 and
  six from July 27. Their timestamps align with the goal-process exits in Loki,
  so the S3 archive path was working.
- The primary incident was a semantic goal failure, not a Kubernetes, Loki,
  Grafana, S3, model-authentication, or tool-transport failure:
  - `get me a pokeman` made 144 successful tool calls and found and weakened a
    Wurmple, but the Bag had no Poké Balls. Its final report explicitly said it
    did not catch a Pokémon.
  - `maybe you need to go to the next town` made 138 successful tool calls.
    Forty-eight of its 54 movement-result calls reported no movement, and it
    stopped without reaching Oldale.
  - `go to the next town, north` made 72 successful tool calls. It entered a
    wild Zigzagoon battle with Torchic at 2/20 HP, fainted, and white-out
    returned the player to Brendan's house.
- Goal state nevertheless labeled the first two unsuccessful outcomes
  `completed`. `GoalManager.observeProcess` defines completion solely as the
  Codex subprocess exiting with code zero; it does not verify the requested
  game-state outcome. The prompt also permits the agent to finish when it can
  no longer make useful progress. A cleanly reported failure is therefore
  recorded and announced as a completed goal.
- The controller did not give the goal agent enough trustworthy state to
  recover:
  - `pokemonctl state` exposes party HP, badges, Pokédex count, last catch, and
    limited spatial state, but not inventory, battle/menu mode, current
    selection, or story flags.
  - The movement-mode masks are off by one bit relative to the pinned Emerald
    engine. The engine defines on-foot/Mach/Acro/Surf/Underwater/Dash as
    `0x01`/`0x02`/`0x04`/`0x08`/`0x10`/`0x80`; the reader uses
    `0x01`/`0x02`/`0x04`/`0x08`/`0x40`. Normal on-foot play is consequently
    reported as `biking`, surfing as `diving`, and other modes are similarly
    shifted or missed.
  - Every non-moving control response is labeled `blocked`, including A/B/START
    inputs in battles and menus where changing map coordinates is not expected.
  - The spatial reader takes map group/number from the player's `ObjectEvent`.
    On a seamless map connection Emerald preserves that object, while the
    authoritative current map moves to `gSaveBlock1Ptr->location` and
    destination-map NPCs are loaded under the new map identity. As a result,
    Route 101 screenshots were reported as Littleroot and Route 101 NPCs were
    omitted from `Nearby objects`. A normal warp, such as the white-out return
    to Brendan's house, refreshed the player object and made the map report
    accurate again.
- There is no semantic goal verifier, navigation/path-planning layer, or
  repeated-blocked-action circuit breaker. The process could therefore spend
  most of a run probing walls, then exit successfully with a report explaining
  that the user goal remained unmet.
- A local reproduction used a copy of the live guild's flash, goal history, and
  goal memory; the real WASM emulator; the current local prompt/controller; the
  production `gpt-5.6-luna` model at medium reasoning; and a real Codex/OpenAI
  session. It ran the exact goal `get me a pokeman` for the configured eight
  minutes.
  - The model's high-level reasoning was sound: it left Birch's lab, reached
    grass, found Wurmple, opened the Bag, recognized there were no Poké Balls,
    escaped, and explicitly changed its plan to reach Oldale for the Poké Ball
    handoff.
  - The control state was already contradictory at boot. A title-screen
    screenshot was paired with a valid-looking Birch Lab position and party.
    Once visibly in the lab, the on-foot player was reported as `biking`.
  - During a visible Wurmple battle, `state` continued to report an overworld
    Littleroot position, `biking`, and tall grass. It exposed neither the battle
    nor the current battle-menu selection, while all battle inputs reported
    `blocked: true`.
  - After escaping, the final screenshot visibly showed Route 101 while state
    still reported Littleroot Town. The run timed out there with Torchic at
    13/20 HP, no catch, and no final Codex report.
  - The agent requested 86 screenshots across 467.928 seconds. With no
    collision grid or route topology, it resorted to blind 15–30-step chords,
    repeatedly overshot or hit obstacles, and triggered more encounters.
  - The copied flash's SHA-256 remained unchanged, confirming that the replay
    did not persist a catch or other save progress.
- The existing `e2e-goal.integration.test.ts` cannot catch these failures. It
  explicitly uses a stub process with canned JSONL and no real model, ROM,
  emulator boot, visual mode, or navigation. The only real-API smoke test was
  left as a manual pre-merge acceptance step. There is also no direct test for
  `readSpatialSnapshot`; formatter tests construct already-decoded spatial
  values and therefore cannot detect incorrect engine offsets or bit masks. A
  focused run of the canned integration test also currently fails because its
  cost assertion expects a dollar amount while production model
  `gpt-5.6-luna` has no list price in the pricing table; the 21 formatter and
  movement-outcome tests pass.
- The evidence points primarily to an observability/control-contract failure,
  not weak Pokémon reasoning by the model. The model can form the right plan,
  but it must operate from screenshots plus structured state that is incomplete
  and sometimes false. The prompt then encourages long held runs, amplifying
  navigation errors when no path topology is available.
- A manual real-emulator drive from Birch's lab through the Route 103 rival
  battle reached the post-victory May dialogue, establishing the human control
  baseline and exposing additional contract failures:
  - A successful door warp returned `moved: false, blocked: true` because the
    control response sampled spatial state before the queued input and warp
    transition had settled.
  - A nominal 15 ms A tap sometimes did not register; a 100 ms tap did. Inputs
    submitted while encounter transitions, text animation, or level-up panels
    were active returned HTTP success but were silently ignored by the game.
  - `press a --quantity 4 --hold-ms 100` becomes one continuous hold because
    hold duration is multiplied by quantity. It is not four discrete presses,
    despite the CLI spelling. This can advance one box, bleed into the next
    state, or auto-select an unintended battle option.
  - Chords run every queued segment even after a collision, warp, encounter, or
    menu transition changes the game context. Later inputs are then applied to
    an entirely different screen than the caller intended.
  - Battle and dialogue progression require observing stable text and an
    input-ready state. Screenshots alone force fixed sleeps and manual visual
    interpretation; the controller exposes neither condition.
  - The Route 103 rival is a hidden prerequisite for receiving the Pokédex and
    Poké Balls. The manual drive had to grind Torchic to level 6, use Growl
    twice, and win at 2 HP. This confirms that “reach the next town” is not a
    sufficient world model for the original catch objective.
- The manual drive is paused safely after defeating May. Its local emulator
  remains available under `/tmp/pokemon-ai-repro.xJYrnR/run-4`; it has not yet
  completed the Birch/May Poké Ball handoff, first capture, or explicit save.

## Session Log — 2026-07-28

### Done

- Inspected the live Kubernetes Deployment, pod, service, PVC, events, image,
  and direct container logs.
- Queried 72 hours of Loki history and correlated both recent play sessions,
  their goal activity, and their shutdown errors.
- Queried Grafana/Prometheus stream and error counters for the same interval.
- Verified the recent `llm-archive` SeaweedFS objects and read the corresponding
  goal outcomes from the persistent save PVC.
- Reconstructed the unsuccessful goals' tool traces and inspected
  representative screenshots from the live save PVC.
- Reproduced the exact failed goal locally for eight minutes against a copy of
  the live save using the real emulator, current controller and prompt, and
  production model.
- Captured direct contradictions between the rendered screen and structured
  state at the title screen, in Birch's lab, during battle, and on Route 101.
- Verified the movement-mode masks against the pinned Emerald engine and found
  the concrete off-by-one bitmask defect.
- Verified that the local replay timed out without changing the copied flash.
- Traced the false `completed` status, misleading movement outcomes, incomplete
  game-state contract, and stale connected-map identity to their current source
  paths and the pinned Emerald engine behavior.
- Traced both secondary log-error shapes to their current source paths.
- Manually drove the real emulator through Route 101, trained Torchic to level
  6, reached May, won the required Route 103 rival battle, and paused after the
  victory dialogue.
- Characterized input-readiness failures, immediate response sampling, ambiguous
  hold quantity semantics, and non-interruptible chords with direct screenshots
  and state responses.

### Remaining

- Add explicit semantic success/failure reporting and verification so a clean
  Codex exit cannot mark an unmet objective complete.
- Read current map identity from the authoritative save location, and preserve
  nearby-object correctness across connected-map transitions.
- Expose battle/menu state and inventory, and make control outcomes
  action-specific instead of labeling every unchanged coordinate as blocked.
- Add navigation recovery or a repeated-no-progress circuit breaker.
- Replace the canned-only goal integration coverage with deterministic
  real-emulator replay/evaluation fixtures covering boot, connected maps,
  menus, battles, inventory blockers, and semantic goal success.
- Bring the canned integration test's pricing fixture into sync with the
  configured production model.
- Fix the secondary selfbot teardown and `logger.error(undefined)` defects.
- Resume the preserved manual run, return to Birch's lab, receive the Pokédex
  and Poké Balls, catch a wild Pokémon, save explicitly, and verify party,
  Pokédex, last-caught, and flash persistence.

### Caveats

- This session was diagnostic and read-only with respect to Kubernetes,
  Grafana, Loki, and S3; no runtime remediation or source-code fix was
  requested or applied.
- `stream_active` is scrape-sampled, so its displayed start/end samples are
  coarser than the exact session timestamps from Loki.
- The investigation proves why these goal attempts failed and were mislabeled;
  the local replay and manual drive establish that the model understands the
  immediate Pokémon strategy and that the current objective is human-completable,
  but the full catch-and-save trace is paused after the rival battle.
- Local reproduction artifacts are under
  `/tmp/pokemon-ai-repro.xJYrnR/` and are ephemeral. Keep the active local
  harness alive if the manual run is to be resumed. The source tree was not
  modified beyond this session log.
