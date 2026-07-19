---
id: reference-completed-2026-06-13-discord-plays-pokemon-goal-nano
type: reference
status: complete
board: false
---

# discord-plays-pokemon `/goal` — nano model + smarter prompt + game-state + cost + observability

## Context

`/goal` drives a 30-min `codex exec` loop using `gpt-5.4-mini` and a short generic prompt. The prompt doesn't nudge the model to chain inputs (`chord`) over single `press` calls, doesn't tell it anything about Emerald, never sees the current game state (party, badges, dex, last catch), and never sees prior goals' outcomes. There's no cost feedback at the end, and when a run goes badly there's no way to replay what the model saw + did.

This plan: switch the default to **`gpt-5.4-nano`**, inject **live Emerald state + recent-goal history** into the system prompt at goal start, expose two new `pokemonctl` subcommands for mid-run refresh, **enrich the prompt with Emerald domain knowledge + chord guidance**, append **`Cost: $X.YY (N in / M out tokens)`** to the final Discord report, and **archive every turn + tool call + screenshot to SeaweedFS via the existing `llm-observability` infra** for post-mortem analysis.

User-approved design choices (from in-session AskUserQuestion):

- State: **snapshot at start + new `pokemonctl state` subcommand** for mid-run refresh.
- Past goals: **rolling last-N completed goals in the snapshot + new `pokemonctl history` subcommand** the model can call for more.
- Pricing: **hardcoded rate table** in `goal/pricing.ts`; if model isn't in the table, skip the cost line silently.
- Observability: **reuse `packages/llm-observability/`** — synthesize OTel spans from Codex's `--json` event stream, let `LlmArchiveSpanProcessor` ship to S3.

## Critical constraint (load-bearing)

`gpt-5.4-nano` cannot use Codex's `tool_search` / `apps` toolset. We **must** pass `--disable apps --disable plugins --disable multi_agent` in the `codex exec` invocation or every turn 400s. Verified by direct probe against `OPENAI_API_KEY` auth. Also: nano rejects ChatGPT-account auth (`The 'gpt-5.4-nano' model is not supported when using Codex with a ChatGPT account`); prod is fine (uses `OPENAI_API_KEY`), but local-dev with a ChatGPT session won't work — document this in the example config.

## Tasks

Sized so each task is one reviewable commit; landed in order. Each task ends with the tests passing for the work it introduces.

| #   | Task                                                                      | Scope                                                                                                                                                                                           | Tests landed with task                                                                                                                                 |
| --- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T1  | Codex args + nano default                                                 | `codex-command.ts` arg list, `schema.ts` default, example config, update existing test snapshots                                                                                                | `schema.test.ts`, `goal-manager.test.ts` updated; new `codex-command.test.ts` asserts the `--disable` flags + `--json` are present                     |
| T2  | JSONL stdout parser + cost lib                                            | New `pricing.ts` + `codex-jsonl.ts` event-stream parser, wire into `goal-manager.streamToLog` replacement, append cost line in `observeProcess`                                                 | New `pricing.test.ts`, new `codex-jsonl.test.ts` (synthetic event stream → expected usage totals + agent_message log calls)                            |
| T3  | Game-state summary                                                        | New `game-state-summary.ts`, plumb live snapshot into `buildPrompt` via new arg; surface a `getLiveSnapshot()` accessor from existing watcher infra                                             | New `game-state-summary.test.ts` (null + populated snapshot cases)                                                                                     |
| T4  | Past-goals history                                                        | `GoalState.history` field + rolling-10 trim + `getHistory(limit)` accessor                                                                                                                      | `goal-manager.history.test.ts` (append + trim + persist round-trip)                                                                                    |
| T5  | `pokemonctl state` / `history` + control-server routes                    | Two new subcommands + two new HTTP routes                                                                                                                                                       | `pokemonctl.state.test.ts`, `pokemonctl.history.test.ts`, `control-server.routes.test.ts`                                                              |
| T6  | Prompt rewrite (Emerald primer + chord guidance + state/history inlining) | Update `buildPrompt` body, take new args, weave in T3/T4 outputs                                                                                                                                | `codex-command.buildPrompt.test.ts` (snapshot the rendered prompt for a fixture goal+state+history)                                                    |
| T7  | Observability — span synthesis + S3 archival                              | Add `llm-observability` dep, init `LlmArchiveSpanProcessor` in `observability/tracing.ts`, new `codex-trace.ts` that turns JSONL events → spans, screenshot upload to SeaweedFS, k8s env wiring | New `codex-trace.test.ts` (synthetic JSONL → expected spans with `gen_ai.*` attrs), new `screenshot-upload.test.ts` (mock S3 → verifies key + content) |
| T8  | E2E test harness                                                          | New `scripts/e2e-goal.ts` runner: spawns real codex against gpt-5.4-nano + real emulator + tiny goal, asserts the new behaviors end-to-end                                                      | See **E2E test plan** below                                                                                                                            |

## Changes

### 1. Switch default model + harden Codex invocation

**File:** `packages/discord-plays-pokemon/packages/backend/src/goal/codex-command.ts`

- `buildCodexArgs` (lines 10–38): add `--disable apps`, `--disable plugins`, `--disable multi_agent` before `--cd`. Add `--json` so we get the usage event on stdout. Keep `--output-last-message` (final report still goes there).
- `--json` switches stdout to JSONL — see change #5 for how `goal-manager.ts` consumes it.

**File:** `packages/discord-plays-pokemon/packages/backend/src/config/schema.ts`

- Line 8 + line 26: default `model` → `"gpt-5.4-nano"`.

**File:** `packages/discord-plays-pokemon/config.example.toml`

- Line 96: `model = "gpt-5.4-nano"`.
- Add a comment noting nano requires `OPENAI_API_KEY` auth (ChatGPT account auth will 400).

### 2. Game-state snapshot for the prompt

**Reuse:** `readGameSnapshot()` (`game/events/snapshot.ts:1-104`) already extracts party (via `pokemon-struct.ts`), badges (8 flags), dexOwned, last caught species.

**New file:** `packages/backend/src/goal/game-state-summary.ts`

- `formatGameStateForPrompt(snapshot: GameSnapshot | null): string` — compact multi-line:
  - `Party: Treecko L12 (HP 29/31), Wurmple L8 (HP 22/22, PSN), …`
  - `Badges (1/8): Stone`
  - `Pokédex owned: 14`
  - `Last caught: Zigzagoon (shiny: no)`
- Null snapshot → `Game state unavailable (no save loaded or mid-relocation).`

**Wire-up:** in `goal-manager.startGoal()`, just before the codex command, call the live snapshot accessor and pass the formatted string into the new `buildPrompt(...)` signature.

**Out of scope here:** money, inventory, location/map (would need new symbols in `emulator/symbols.ts`).

### 3. Past-goals history

**File:** `packages/backend/src/goal/goal-manager.ts` (`GoalState` shape lines 19–32, `persistState` line 483)

- Extend persisted shape: `history: CompletedGoal[]` on the same `goal-state.json`.
  - `CompletedGoal = { goal; requestedBy; startedAt; finishedAt; status; finalReport?; exitCode? }`.
- On completion in `observeProcess()` (~line 395+): append, trim to last 10.
- Expose `getHistory(limit: number)` on GoalManager.

### 4. New `pokemonctl` subcommands: `state` and `history`

**File:** `packages/backend/src/goal/pokemonctl.ts`

- `state`: HTTPs the control-server `/state`, prints the formatted summary.
- `history [--limit N]` (default 3): HTTPs `/history?limit=N`, prints goal title + outcome blurb per entry.

**File:** `packages/backend/src/goal/control-server.ts`

- Two new routes returning the same human-readable strings the formatter produces.

### 5. Cost reporting

**New file:** `packages/backend/src/goal/pricing.ts`

- `MODEL_RATES: Record<string, { input; cachedInput; output }>` — per 1M tokens. Look up current OpenAI list prices when writing. Default `null` if model missing.
- `computeCost(model: string, usage: TurnUsage): number | null`.
- `formatCostLine(cost: number | null, usage: TurnUsage): string`.

**New file:** `packages/backend/src/goal/codex-jsonl.ts`

- Stream parser that consumes Codex's JSONL stdout. Emits an event-bus interface that goal-manager + codex-trace both subscribe to.
- Accumulates `turn.completed.usage` into running totals.
- Forwards parse errors as raw lines to the logger (don't crash the goal).

**File:** `packages/backend/src/goal/goal-manager.ts`

- Replace `streamToLog` for codex stdout with the JSONL parser.
- In `observeProcess()` final-message construction (~line 417–423): append `\nCost: $${cost.toFixed(4)} (${totalIn}↑ / ${totalOut}↓ tokens)` when `formatCostLine` returns a price line; otherwise append `\nTokens: …` only.

### 6. Prompt rewrite

**File:** `packages/backend/src/goal/codex-command.ts` `buildPrompt()` (lines 40–59)

New signature: `buildPrompt(goal, gameStateSummary, recentGoals)`. Produce:

- Existing prompt-injection guard around the user goal.
- **Emerald domain primer (~15 lines):** Gen 3 Emerald on GBA; overworld → menu → dialog → battle loop; A advances/confirms, B cancels; START opens menu (POKEMON/BAG/SAVE/OPTIONS); battles are turn-based FIGHT/BAG/POKEMON/RUN; common scripted sequences (Birch intro, rival fight at routes); badge order Stone → Knuckle → Dynamo → Heat → Balance → Feather → Mind → Rain and their gym leaders.
- **Tool guidance:** prefer `chord` for predictable sequences (`pokemonctl chord '5a'` to mash A 5 times; `pokemonctl chord 'd d a'` to nav a menu). Single `press` is for one-offs. Remind: chord grammar = `[quantity][modifier][command]`, modifiers `-` burst / `_` hold / `^` holdB.
- **State commands:** "`pokemonctl state` shows current party/badges/dex — call it after meaningful events (trainer defeated, new building) to re-orient. `pokemonctl history --limit N` shows recent goals."
- Inlined current `gameStateSummary`.
- Inlined last 3 goals (title + 2-line outcome); hint that `pokemonctl history --limit 10` exists for more.
- Existing final-answer summary requirement.

### 7. Observability — every turn + tool call + screenshot → SeaweedFS

**Reuse:** `LlmArchiveSpanProcessor` from `packages/llm-observability/` already gzips + PUTs span envelopes (request body, response body, tools, usage) to S3 when spans carry `gen_ai.*` attributes, and forwards a slim span to Tempo with an `llm.archive.url` for click-through. Same env wiring used by temporal/birmel/scout.

**Wiring:**

1. **Add `llm-observability` dep** to `packages/discord-plays-pokemon/packages/backend/package.json`.
2. **Init** — `packages/backend/src/observability/tracing.ts:63-107`: install `LlmArchiveSpanProcessor` alongside the existing `BatchSpanProcessor`. Env:
   - `LLM_OBSERVABILITY_ENABLED=true`
   - `S3_ENDPOINT=https://seaweedfs.sjer.red`
   - `LLM_ARCHIVE_S3_BUCKET=llm-archive`
   - `LLM_ARCHIVE_S3_PREFIX=goals/discord-plays-pokemon`
   - `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` from the existing SeaweedFS 1P secret.
     Add to `packages/homelab/src/cdk8s/src/resources/pokemon.ts` next to `OTLP_ENDPOINT` (lines 80–85).
3. **JSONL → OTel adapter** — new file `packages/backend/src/goal/codex-trace.ts`. Subscribes to the `codex-jsonl.ts` event bus from change #5:
   - **`pokemon.goal.run`** — root span, opened in `startGoal()`, closed in `observeProcess()`. Attrs: goal, requestedBy, model, max_runtime_minutes, gameStateSummary.
   - **`pokemon.goal.turn`** — child per Codex turn (`turn.started` → `turn.completed`). On end: `gen_ai.system="openai"`, `gen_ai.request.model`, `gen_ai.usage.input_tokens` / `cached_input_tokens` / `output_tokens` / `reasoning_output_tokens`. Attach the prompt slice as `gen_ai.input.messages` and the `agent_message` text(s) as `gen_ai.output.messages`. `LlmArchiveSpanProcessor` auto-archives.
   - **`pokemon.goal.tool`** — child per `ExecCommandBegin` → `ExecCommandEnd`. Attrs: command, exit_code, stdout/stderr snippets (truncated), duration. Helpful for catching "model is mashing A in a loop" patterns.
   - **Reasoning** captured as span events on the turn span.
4. **Screenshots → SeaweedFS** — adapter watches for `ExecCommandEnd` with command starting with `pokemonctl screenshot` and a `{"path": "..."}` stdout payload. Fire-and-forget upload to `goals/<goal-id>/screenshots/<frame>.png` and attach the public URL as a span attribute. Use a small inlined `putObject` helper (~20 lines) rather than depending on `toolkit`.
5. **Console fallback** — if `LLM_OBSERVABILITY_ENABLED` is unset, the adapter still logs every turn + tool call through the existing Winston logger (`#src/logger`). Spans become no-ops.
6. **Grafana discoverability** — Tempo now shows `pokemon.goal.run` traces with token attrs and `llm.archive.url` linking to the gzipped envelope. No dashboard work in this PR.

## Files to modify (summary)

- `packages/backend/src/config/schema.ts` — default model
- `packages/backend/src/config/schema.test.ts` — model assertion
- `packages/backend/src/goal/codex-command.ts` — args + prompt + signature
- `packages/backend/src/goal/goal-manager.ts` — history, JSONL parser hookup, cost line, span lifecycle
- `packages/backend/src/goal/goal-manager.test.ts` — fixture model
- `packages/backend/src/goal/pokemonctl.ts` — `state`/`history` subcommands
- `packages/backend/src/goal/control-server.ts` — routes
- `packages/backend/src/goal/game-state-summary.ts` — **new**
- `packages/backend/src/goal/pricing.ts` — **new**
- `packages/backend/src/goal/codex-jsonl.ts` — **new** (event-stream parser)
- `packages/backend/src/goal/codex-trace.ts` — **new** (span synthesis)
- `packages/backend/src/observability/tracing.ts` — install `LlmArchiveSpanProcessor`
- `packages/backend/package.json` — add `llm-observability` dep
- `packages/discord-plays-pokemon/config.example.toml` — model + auth note
- `packages/discord-plays-pokemon/scripts/e2e-goal.ts` — **new** E2E harness (see test plan)
- `packages/homelab/src/cdk8s/src/resources/pokemon.ts` — observability env vars + secret keys

Reuses:

- `readGameSnapshot()` (`game/events/snapshot.ts`)
- `MemoryReader` (`emulator/memory.ts`)
- `truncateForDiscord` / `sanitizeDiscordText` (existing in `observeProcess`)
- `LlmArchiveSpanProcessor`, `buildArchiveSpanProcessor()` (`packages/llm-observability/src/`)
- `withSpan()` (`packages/backend/src/observability/tracing.ts`)

## Test plan

### Unit (bun:test, no externals)

| File                           | What it covers                                                                                                                                                                                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pricing.test.ts`              | known model → expected cents math (input + cached + output); unknown model → `null`; `formatCostLine(null, usage)` still emits the token-count line                                                                                                                                      |
| `game-state-summary.test.ts`   | null snapshot → `Game state unavailable…`; populated snapshot → exact expected string (party w/ HP + status, badges by name, dex count, last catch + shiny)                                                                                                                              |
| `codex-jsonl.test.ts`          | feed synthetic JSONL bytes (chunked across boundaries) → parser emits `turn.started`, `agent_message`, `tool_call`, `turn.completed` events in order; accumulates usage; falls back gracefully on a malformed line                                                                       |
| `codex-command.test.ts`        | `buildCodexArgs` includes `--disable apps --disable plugins --disable multi_agent --json --output-last-message`; in correct order; `buildPrompt(goal, state, history)` includes the prompt-injection guard, the Emerald primer, chord guidance, the state block, and last-3 goal entries |
| `codex-trace.test.ts`          | drive the adapter with fixture JSONL → expected span tree (one run → N turn children → tool children) with `gen_ai.*` attrs on each turn; reasoning summaries land as span events                                                                                                        |
| `goal-manager.history.test.ts` | append + trim to 10 + persist round-trip; `getHistory(3)` returns the most-recent 3 in reverse-chronological order                                                                                                                                                                       |
| `screenshot-upload.test.ts`    | mock S3 client → upload uses expected bucket/key (`goals/<id>/screenshots/<frame>.png`), content-type `image/png`, returns expected public URL                                                                                                                                           |

### Integration (bun:test, real subprocess where cheap)

| File                                | What it covers                                                                                                                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pokemonctl.state.test.ts`          | start the goal control-server with a stub snapshot accessor, run `pokemonctl state` as a subprocess, assert stdout matches the formatter                                                            |
| `pokemonctl.history.test.ts`        | seed `goal-state.json` with 5 fake history entries, run `pokemonctl history --limit 3`, assert stdout                                                                                               |
| `control-server.routes.test.ts`     | `/state`, `/history?limit=N`, error cases (limit out of range, missing snapshot)                                                                                                                    |
| `goal-manager.jsonl-wiring.test.ts` | spawn a mock "codex" script that just emits a canned JSONL stream → goal-manager parses, computes cost, emits Discord message with the cost+token line, persists history entry, closes the run span |

### E2E (new harness, opt-in — not run in CI by default)

**File:** `packages/discord-plays-pokemon/scripts/e2e-goal.ts`

Modeled on the existing manual mk64 `e2e:scenario` harness pattern. Reads `OPENAI_API_KEY` from env; spins up a real headless emulator with a known save state checked into `packages/backend/test-fixtures/e2e-goal.sav` (a saved state right after Birch's intro — tiny, ~128 KiB); starts the goal control-server + the JSONL parser + span pipeline; spawns real `codex exec --model gpt-5.4-nano` with a tiny goal ("advance dialog until you can move freely"); enforces a 2-min wall-clock cap so it doesn't bankrupt anyone.

Assertions:

1. **Exit code 0** and a non-empty final report.
2. **Cost line present** in the synthesized final message; price is `> 0` and `< $0.10` (sanity cap for a 2-min run).
3. **Tokens > 0** for input + output.
4. **`history.json`** contains exactly one new completed entry with the right `goal` text + `exitCode: 0`.
5. **Spans recorded** in an in-memory `InMemorySpanExporter` plumbed alongside the real exporter: at least one `pokemon.goal.run`, ≥1 `pokemon.goal.turn`, ≥1 `pokemon.goal.tool`. Each turn has `gen_ai.usage.*` attrs.
6. **At least one screenshot upload was attempted** (S3 client is swapped for a recording mock that just collects keys); the key matches `goals/<id>/screenshots/*.png`.
7. **`pokemonctl state` works** mid-run — the assertion is that the JSONL trace contains an `ExecCommandEnd` for `pokemonctl state` (proves the model actually used it). Soft-warn rather than fail if it didn't — the model's free choice. Hard-fail only if the command would have errored.

Run command (added to `packages/discord-plays-pokemon/package.json` scripts):

```bash
bun run e2e:goal      # short Emerald goal, ~$0.05, ~2 min
```

CI: **not run by default** — needs an API key + a ROM in Syncthing (per the existing `reference_mk64_rom_and_harness.md` memory pattern). Document in the package README that this is a manual pre-merge gate.

### Acceptance (manual smoke before merging)

- `bun run typecheck` clean, `bun run test` clean, `bunx eslint . --fix` clean.
- `bun run e2e:goal` succeeds against `gpt-5.4-nano` with a real API key.
- Verify on Grafana / Tempo: `pokemon.goal.run` trace from the e2e is queryable; clicking `llm.archive.url` opens the gzipped envelope on SeaweedFS containing the prompt + agent messages + tool calls.
- Verify screenshot URL on a tool span loads (`https://public.sjer.red/...`).
- Cost realism — for a real 30-min `/goal`, total comes in around the predicted $0.10–$0.30 for nano (vs. $0.50–$1 for mini).

## Out of scope (recorded in ROADMAP as follow-ups)

- Money / bag / location / map-name extraction from memory.
- Per-turn intermediate cost broadcasts (only end-of-goal in this PR).
- Configurable pricing via `config.toml`.
- HTTPS-proxy archival of raw OpenAI request bodies — only needed if JSONL fidelity proves insufficient.
- Grafana dashboard for per-goal token spend / tool-call heatmap.
- Wiring `bun run e2e:goal` into CI on a nightly schedule (cost + ROM-distribution issue).

## Session Log — 2026-06-13

### Done

- T1 (`bec40f9a2`) — default model → `gpt-5.4-nano`; codex args carry `--disable apps/plugins/multi_agent` + `--json`.
- T2 (`4ac138ced`) — `pricing.ts` + `codex-jsonl.ts`; final Discord report ends with `Cost: $X.YY (Tokens: N in / M out)`.
- T3 (`b7f28b641`) — `game-state-summary.ts` (party/badges/dex/last-catch formatter).
- T4 (`4cb8795f9`) — rolling 10-entry history persisted to `goal-state.json` + `getHistory(limit)`.
- T5 (`c66a7d509`) — `pokemonctl state` / `pokemonctl history` subcommands + control-server `/state` + `/history` routes.
- T6 (`eba0aeaba`) — `buildPrompt` rewrite with Emerald primer + chord guidance + inlined state/history.
- T7 (`05ed743f3`) — `codex-trace.ts` JSONL→OTel adapter; `tracing.ts` wraps the OTLP exporter in `LlmArchiveSpanProcessor`. Backend code ready; k8s env wiring documented in `packages/docs/todos/dpp-goal-llm-archive-creds.md`.
- T8 (`676e2681c`) — `e2e-goal.integration.test.ts` (the `bun run e2e:goal` alias) drives the full T1-T7 surface via a stub codex spawner.
- PR #1180 opened against `main`.

### Remaining

- Open follow-up todo `dpp-goal-llm-archive-creds` (committed in T7): add `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` to the pokemon-config 1P item, refresh the snapshot, then enable the homelab env-var wiring at the `TODO(todo:dpp-goal-llm-archive-creds)` marker in `packages/homelab/src/cdk8s/src/resources/pokemon.ts`.
- Manual real-API smoke: trigger a `/goal` against prod once the next image rolls out, verify the cost line appears in Discord and the spans land in Tempo.

### Caveats

- `gpt-5.4-nano` rejects ChatGPT-account Codex auth ("not supported with a ChatGPT account"). Prod uses `OPENAI_API_KEY`, so prod is fine; local-dev needs the API key (documented in `config.example.toml`).
- `pricing.ts` rates were copied from `packages/scout-for-lol/.../models.ts`. If OpenAI prices change, that table needs updating — the cost line will silently drop to "no list price on file" for unknown models, but mini/nano numbers are hardcoded.
- E2E harness uses a stub spawner — it does NOT call the real OpenAI API. The matching real-API smoke (paid call, needs ROM + emulator + control-server) stays a manual pre-merge gate.
- Backend code ships fine without the SeaweedFS S3 creds: `LlmArchiveSpanProcessor` no-ops when `LLM_OBSERVABILITY_ENABLED` is unset, so spans flow to Tempo but no S3 archive is created until the follow-up lands.
