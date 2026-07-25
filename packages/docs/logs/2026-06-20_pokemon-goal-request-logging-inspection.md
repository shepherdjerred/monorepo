---
id: log-2026-06-20-pokemon-goal-request-logging-inspection
type: log
status: complete
board: false
---

# Pokemon goal request-logging inspection

## Context

User asked whether discord-plays-pokemon has request logging that can be
inspected, and to look at today's (2026-06-20) run.

## Findings

The bot's "goal" system is Codex-driven (model `gpt-5.5`). Request logging lives
in three places:

| Surface                        | Content                                                                                                        | Query                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Loki                           | Per-turn model reasoning (`goal codex agent_message:`), codex stdout/stderr                                    | `{namespace="pokemon"} \|~ "goal codex"`                    |
| Tempo                          | `pokemon.goal.run` root span → `pokemon.goal.turn` / `pokemon.goal.tool` children; goal text, requester, model | `{ name = "pokemon.goal.run" }`                             |
| SeaweedFS `llm-archive` bucket | Full gzipped request/response bodies, ref'd by `llm.archive.s3_key` span attr                                  | `goals/discord-plays-pokemon/.../2026/06/21/<traceid>-*.js` |

Final report + cost line is posted to Discord (not in Loki).

Code: `packages/discord-plays-pokemon/packages/backend/src/goal/` —
`codex-jsonl.ts` (permissive JSONL parser), `codex-trace.ts` (JSONL→OTel span
synthesis), `observability/tracing.ts` (OTLP→Tempo + `buildArchiveSpanProcessor`
from `@shepherdjerred/llm-observability`).

### Today's runs (2026-06-20 PT), all from Discord user 160509172704739328, model gpt-5.5

| Time (PT) | Goal               | Duration |
| --------- | ------------------ | -------- |
| 00:41     | catch me a pokeman | ~833s    |
| 00:55     | save the game      | ~114s    |
| 19:03     | catch a pokeman    | ~790s    |
| 19:16     | catch a pokeman    | ~219s    |

Evening "catch a pokeman" session: party was just Torchic "AZ" L5, 0 badges,
Pokédex owned 1, nothing caught this session. Agent hit a wild Wurmple, found the
bag had **zero Poké Balls**, then spent the run navigating Route 101 toward
Oldale Mart to buy balls (fighting bike controls on tight corners, re-routing
around ledges, sweeping grass). No catch yet — blocked on no Poké Balls.

Pod restarted today: `goal-manager: loaded N history entries` at 00:41 PT (4) and
19:03 PT (6).

## Caveat — token/cost telemetry is blank

Every `pokemon.goal.run` trace today shows only **1 turn span with 0 tokens** and
**0 tool spans**, despite heavy `agent_message` activity. The body archive works
(bodies land in `llm-archive`), but the `turn.started`/`turn.completed` and
`ExecCommandBegin/End` events that `codex-trace.ts` keys off of aren't matching
what the current Codex CLI emits, so per-turn tokens, tool-call spans, and the
derived cost (`computeCost` in `goal-manager.ts`) come back empty. The parser is
schema-permissive by design (`codex-jsonl.ts`), so this fails silently. Likely a
Codex CLI event-name drift. Not fixed this session — would need to capture the
actual JSONL the CLI emits now and re-map event types.

## Root cause — agent confused battle for overworld ("running into walls")

User reported the agent kept running into walls and, mid-battle, would act as if
still walking in the overworld for 1–2 min. Investigated; root cause found.

**`pokemonctl state` has no battle/menu/dialog indicator — it only describes the
overworld.**

- `stateResponse` (`control-server.ts:129-135`) builds text from
  `readGameSnapshot` + `readSpatialSnapshot` only.
- `formatGameStateForPrompt` (`game-state-summary.ts:18-37`) emits only overworld
  lines: party / badges / dex / Location(map,x,y,facing) / Standing-on / Nearby.
- Grep of `game/` + `emulator/` readers: **no battle/mode/`gMain`/`inBattle`
  field is read anywhere.** Surfacing battle state needs a NEW memory reader
  (e.g. `gMain.inBattle` / `gBattleTypeFlags` / active main-callback symbol from
  pokeemerald-wasm), not just unsurfaced data.
- During battle the overworld coords in memory are frozen at the last overworld
  tile, so `state` reports a plausible-but-stale `Location:` line — looks
  identical to standing still in the field.
- The prompt tells the model to TRUST state over pixels:
  `codex-command.ts:98` ("DO NOT guess facing from pixels when state is
  available"), `:215`, `:237` ("Call this BEFORE guessing from pixels").
  Combined with `model_reasoning_effort="low"` (`codex-command.ts:45`), the model
  leans on the misleading text signal and only escapes via screenshots.

**Log evidence (evening run, 06-20 PT):**

```
19:08:53  Battle is over. I'm riding north...            (thinks overworld)
19:09:05  North is blocked from this grass tile...        (not walking)
19:09:18  position didn't change... bike is stuck against trees
19:09:22  We were still in the battle menu on Bag; I hadn't actually selected Run.
19:09:38  Run succeeded and the text box is still up.
19:09:45  The overworld is active again
```

~30–60s believing it was wall-blocked in the overworld while actually in the
battle menu. Same on the Wurmple fight (19:16:56→19:18:04, 24s/44s gaps).
Overworld nav thrash 19:05–19:13 (first-press-turns-only rule + async chord
movement → checks state mid-move → sees stale pos → declares "blocked" →
reroutes). Also recurring bag-pocket misread (Items vs Poké Balls pocket:
19:08:45, 19:13:46, 19:18:04) → kept (wrongly) concluding "no Poké Balls" →
never caught anything.

**Proposed fix:** add a game-mode field to `state` (battle/menu/dialog/overworld)
via a new memory reader; suppress/caveat overworld spatial lines when not in
overworld; prompt tweak to stop trusting overworld coords during battle.
Secondary: have `state` report whether last input changed (x,y) so
blocked-vs-just-turned-vs-not-in-overworld is unambiguous. NOT yet implemented.

## Session Log — 2026-06-20

### Done

- Confirmed + mapped the three request-logging surfaces (Loki / Tempo / SeaweedFS llm-archive)
- Summarized today's 4 goal runs from Tempo + the live agent-reasoning stream from Loki
- Diagnosed the battle/overworld-confusion + wall-running root cause (see section above), with code refs + log evidence

### Remaining

- Implement the battle/menu-aware `state` fix (worktree + PR) — not started
- (Optional) Pull full archived request/response bodies from `llm-archive` for a run
- (Optional) Investigate + fix the token/turn/tool telemetry gap (Codex JSONL event-name drift)

### Caveats

- Battle-mode reader feasibility depends on pokeemerald-wasm exporting `gMain`/battle symbols — verify before building
- Token-usage and tool-call spans are not landing (see earlier Caveat); cost telemetry is effectively blank
- Timestamps in Loki/Tempo are UTC; today's evening runs show as 2026-06-21T02:xxZ
