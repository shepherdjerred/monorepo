---
id: plan-pokemon-goal-luna-observability
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Pokemon goal: gpt-5.6-luna + full agent blackbox observability

## Problem

Live goal mode thrashing (Littleroot north-exit oscillation) is hard to diagnose from k8s logs. Today we only see Codex `agent_message` narration — not tool calls, tool results, or spatial before/after. Separately, the model/reasoning setup is wrong for the task:

| Source                         | What runs today                              |
| ------------------------------ | -------------------------------------------- |
| Prod `config.toml` (1P secret) | `model = "gpt-5.5"`                          |
| `buildCodexArgs`               | `model_reasoning_effort="low"` **hardcoded** |
| Repo defaults / example        | `gpt-5.4-nano`                               |

So prod is already on flagship **5.5** with **low** reasoning — expensive _and_ underthinking. Tool I/O is mostly invisible in Loki.

## Goals

1. Switch goal model to **`gpt-5.6-luna`** (cheapest 5.6 tier; OpenAI positions it as the nano-class successor) with **`medium`** reasoning effort.
2. Full **agent blackbox**: every tool call + what the agent saw + movement outcome, in structured logs _and_ OTel/S3 archive, plus spatial delta returned to the model on press/chord.

Non-goals this pass: collision maps, screenshot overlays, pathfinding, prompt rewrite for hold policy (follow-up once we can _see_ the loop).

## Model facts (verified 2026-07-26)

| ID                       | Role                      | Input / Output ($/1M) |
| ------------------------ | ------------------------- | --------------------- |
| `gpt-5.6-luna`           | cheapest 5.6 (nano-class) | $1 / $6               |
| `gpt-5.6-terra`          | mid                       | $2.50 / $15           |
| `gpt-5.6-sol`            | flagship 5.6              | $5 / $30              |
| `gpt-5.5` (current prod) | flagship                  | $5 / $30              |
| `gpt-5.4-nano`           | old cheap default         | $0.20 / $1.25         |

Luna is ~5× cheaper than current prod 5.5 on token rates, with reasoning token support. Medium effort will burn more output/reasoning tokens than low — still expected net save vs 5.5+low for comparable turns, and better decisions.

## Current architecture (relevant bits)

```
/goal → GoalManager.spawn(codex exec --json --model …)
         → pokemonctl (shell) → HTTP control server → emulator
Codex JSONL → createCodexJsonlParser → attachCodexTrace (OTel)
             → only agent_message logged to winston at info
```

Gaps:

- **No control-server request logging** (`control-server.ts` only logs listen + errors).
- **press/chord response** = `{ ok, frame }` — no position/facing delta.
- **OTel tool spans** truncate stdout/stderr to **200 chars** (`snippet()` in `llm-observability/src/codex-trace.ts`).
- **Root `initialPrompt`** is `goal=…\nstate=…`, not the full system prompt from `buildPrompt()`.
- **Reasoning effort** not in config schema.

## Design

### A. Model + reasoning config

**Schema** (`packages/backend/src/config/schema.ts` `[game.goal]`):

```toml
[game.goal]
model = "gpt-5.6-luna"
reasoning_effort = "medium"   # low | medium | high | xhigh
```

- Add `reasoning_effort` zod enum, default `"medium"`.
- Thread into `CodexCommandConfig` and `buildCodexArgs`:
  - `'model_reasoning_effort="${config.reasoningEffort}"'` (was hardcoded `"low"`).
- Defaults / example / tests: model → `gpt-5.6-luna`, effort → `medium`.
- Keep `--disable apps/plugins/multi_agent` (safe for small models; luna may not need it but harmless).

**Pricing catalog** (`packages/llm-models/src/catalog.json`):

Add `gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-5.6-sol` with verified rates (leave 5.4 entries — still used elsewhere). Update `catalog.test.ts` + dpp `pricing.test.ts` for luna.

**Prod config** (1Password item mounted as `config.toml`):

```toml
[game.goal]
enabled = true
model = "gpt-5.6-luna"
reasoning_effort = "medium"
# …existing screenshot_dir / state_path…
```

Edit via `op` on the pokemon config item (item id in `pokemon.ts` OnePasswordItem). Pod picks up on restart after operator sync.

### B. Spatial outcome on every movement tool

Extend press/chord JSON responses so the model **and** logs always see movement result:

```ts
{
  ok: true,
  frame: number,
  before: { map, x, y, facing, mode },  // from readSpatialSnapshot
  after:  { map, x, y, facing, mode },
  moved: boolean,   // x/y/map changed
  blocked: boolean, // same tile after a direction press (turn-only or wall)
}
```

Implementation:

1. Helper `readSpatialLite(emulator)` → pick fields from existing `readSpatialSnapshot`.
2. `pressResponse` / `chordResponse`: snapshot before → execute → snapshot after → return delta.
3. Tests for the response shape.

This alone should cut “I pressed north and nothing happened” thrash once the model reads it — and makes logs explain oscillation without screenshots.

### C. Structured tool logging (Loki / `kubectl logs`)

Add a small logger helper that emits **one structured winston info per control request**:

```json
{
  "msg": "goal.tool",
  "goalId": "…",
  "method": "POST",
  "path": "/chord",
  "durationMs": 412,
  "request": { "value": "10_r" },
  "response": {
    "ok": true,
    "before": { "map": "Littleroot Town", "x": 10, "y": 14, "facing": "east" },
    "after": { "map": "Littleroot Town", "x": 16, "y": 14, "facing": "east" },
    "moved": true,
    "blocked": false
  }
}
```

Coverage:

| Route                       | Log request        | Log response                                 |
| --------------------------- | ------------------ | -------------------------------------------- |
| `POST /chord`, `/press`     | chord/button + qty | full spatial delta                           |
| `POST /screenshot`          | —                  | path + frame                                 |
| `GET /state`                | —                  | **full state text** (what the agent inlines) |
| `GET /history`              | limit              | body (truncate ~2k if huge)                  |
| `POST /progress`            | message            | ok/throttled                                 |
| memory list/read/grep/write | path/q             | status + size/snippet                        |

Wire `goalId` by storing active id on GoalManager and passing a getter into control server context.

Also log from the **Codex JSONL side** (parser already has `logger.info` for agent_message):

- On `ExecCommandBegin`: `codex tool begin` + full command.
- On `ExecCommandEnd`: `codex tool end` + exit_code + **full stdout/stderr** (cap ~8–16 KiB, not 200).

### D. Richer OTel / S3 archive

In `packages/llm-observability` (shared):

1. **Dual-track tool body size**: keep short Tempo attr (`…_snippet` ≤200) and put full stdout/stderr on body attrs the archive processor strips to S3. Add new keys to `BODY_ATTR_KEYS`.
2. **dpp `attachCodexTrace`**: pass **full** `buildPrompt(...)` as `initialPrompt` (not the tiny `goal=\nstate=` stub).
3. Structured logs + fuller stdout may suffice if pokemonctl prints the new JSON.

### E. Deploy path

1. Code PR (dpp + llm-models + llm-observability).
2. Update 1P `config.toml` model + reasoning_effort.
3. Ship image via CI → Argo; restart pokemon pod after secret sync.
4. Short `/goal` verify:
   - logs show `goal.tool` lines with spatial deltas
   - Discord cost line prices luna correctly
   - Tempo/S3 archive has full prompt + tool stdout

## File checklist

| Area             | Files                                                                           |
| ---------------- | ------------------------------------------------------------------------------- |
| Config           | `schema.ts`, `config.example.toml`, schema tests                                |
| Codex args       | `codex-command.ts`, `codex-command.test.ts`                                     |
| Catalog          | `llm-models/src/catalog.json`, catalog tests, `pricing.test.ts`                 |
| Movement outcome | `control-server.ts`, spatial helper, tests                                      |
| Tool logs        | `control-server.ts`, `goal-manager.ts` (goalId), logger helper                  |
| Codex log        | `codex-jsonl.ts` and/or dpp subscriber in `goal-manager.ts`                     |
| OTel             | `llm-observability/src/codex-trace.ts`, `archive-span-processor.ts`, unit tests |
| Trace wiring     | dpp `codex-trace.ts`, `goal-manager.ts` initialPrompt                           |
| Prod             | 1Password pokemon config item `config.toml` field                               |

## Tests

- `buildCodexArgs` emits configured model + `model_reasoning_effort="medium"`.
- Schema accepts `reasoning_effort` enum; rejects garbage.
- `computeCost("gpt-5.6-luna", …)` non-null and matches catalog math.
- press/chord response includes before/after; `moved`/`blocked` correct.
- Control-server logging: unit-test pure `summarizeToolLog(...)` if extracted.
- llm-observability: tool end archives full stdout when over 200 chars; Tempo attr still snipped.
- Existing e2e-goal integration still green.

## Verification

```bash
bunx turbo run test typecheck lint \
  --filter=@shepherdjerred/discord-plays-pokemon \
  --filter=@shepherdjerred/llm-models \
  --filter=@shepherdjerred/llm-observability

# after deploy:
kubectl logs -n pokemon deploy/pokemon --tail=200 | rg 'goal\.tool|codex tool'
```

## Risks / notes

- **Medium reasoning + vision screenshots** increases per-turn latency/cost vs low; luna base rate is still well below current 5.5.
- **Full state text in logs** can be chatty; acceptable for debug; sample later if noisy.
- **1P config change** is outside git — PR notes that prod model flip is a vault edit + pod restart.
- Not on bike (early game) — prior analysis overweighted bike; oscillation is hold-quantum + missing delta. Returning `blocked`/`moved` is the direct fix for FAR-left/FAR-right once the model sees it.

## Implementation order

1. Catalog + schema + `buildCodexArgs` (model/effort) — smallest, unblocks prod flip.
2. Spatial delta on press/chord + control-server structured logs.
3. Codex tool begin/end logging + full initialPrompt.
4. llm-observability full tool body archive.
5. 1P config update + deploy verify.

## Remaining

- [ ] Merge PR and wait for discord-plays-pokemon image bump
- [ ] Update 1P pokemon `config.toml`: `model = "gpt-5.6-luna"`, `reasoning_effort = "medium"`
- [ ] Restart pokemon pod and verify live `/goal` logs show `goal.tool` + spatial deltas

## Session Log — 2026-07-26

### Done

- Model default → `gpt-5.6-luna` + configurable `reasoning_effort` (default `medium`)
- Catalog pricing for `gpt-5.6-{luna,terra,sol}`
- press/chord return spatial `before`/`after`/`moved`/`blocked`
- `goal.tool` structured logs on every control-server request
- Codex tool begin/end logs with full stdout/stderr (16 KiB cap)
- OTel archives full tool bodies via `gen_ai.tool.stdout/stderr`; full system prompt as `initialPrompt`
- Split control-server routes + spawn-goal-codex to stay under max-lines

### Remaining

- Prod 1P `config.toml` flip + pod restart after image ships
- Live `/goal` verification once deployed

### Caveats

- Image must ship before code changes take effect; 1P config alone only changes model/effort once the new binary is up (reasoning_effort field ignored by old binary)
- Full state text in logs can be chatty
