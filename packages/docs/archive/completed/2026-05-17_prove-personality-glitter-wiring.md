---
id: reference-completed-2026-05-17-prove-personality-glitter-wiring
type: reference
status: complete
board: false
---

# Prove personality + glitter-timeline wiring (scout-for-lol & birmel)

## Context

Both [scout-for-lol](../../scout-for-lol) and [birmel](../../birmel) inject two things into LLM system prompts: a **personality** (per-reviewer voice / per-guild persona) and the **"Glitter Boys" timeline** (multi-year friend-group history + a relationship graph). By code inspection the wiring is correct, but nothing automatically proves the content actually reaches the LLM.

Goal: prove correctness **now** without touching runtime behavior — unit tests that assert the strings land in the rendered prompt, plus a read-only inspector for scout's already-persisted S3 traces.

## Current state

| Package       | Personality wired in                                                                                                    | Glitter wired in                                                                    | Runtime proof today                                                                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| scout-for-lol | `packages/scout-for-lol/packages/data/src/review/pipeline-stages.ts:182-183` (`PERSONALITY_INSTRUCTIONS`, `STYLE_CARD`) | `pipeline-stages.ts:184-185` (`FRIEND_GROUP_HISTORY`, `RELATIONSHIP_GRAPH`)         | ✅ **Full Stage-2 system prompt** is captured in `StageTrace.request.systemPrompt` and saved to S3 at `{matchId}/ai-pipeline/2-review-text.json`. No CLI to read it back. |
| birmel        | `packages/birmel/src/voltagent/agents/system-prompt.ts:182,189` via `buildPersonaBlock` (supervisor + all 6 sub-agents) | `system-prompt.ts:25-39` `GLITTER_BOYS_LORE_BLOCK` (concatenated at lines 182, 189) | ❌ OTel spans → Tempo capture Discord IDs + duration only. VoltAgent + `@ai-sdk/openai` do **not** auto-capture `instructions`. _(Out of scope; deferred.)_               |

Tests covering these prompt builders: **zero** in both packages before this change.

## Plan

### 1. scout-for-lol — unit test for Stage-2 prompt construction

Test `generateReviewTextStage` with a stub `OpenAIClient` that captures the rendered `systemPrompt` argument and returns canned text. Build a `Personality` fixture with distinctive markers. Assert the captured prompt contains personality instructions, style card author, a stable marker from `glitter-boys-history.txt`, a `digraph` token + node from `relationships.txt`, and reviewer/player name substitutions.

### 2. birmel — unit tests for prompt builders (pure functions, no runtime change)

Cover `buildSupervisorPrompt`, `buildSubAgentPrompt`, `buildPersonaBlock` for both populated and null persona; assert the glitter lore block is always present. Plus a style-card loop test that every shipped JSON parses cleanly through `StyleCardSchema`.

### 3. scout-for-lol — read-only trace inspector CLI

Standalone `bun` script: `--match <matchId>`, optional `--stage`, `--date`, `--days`. Pulls trace JSON from S3 and prints detected persona, presence booleans for glitter history + relationship graph, content previews, and prompt sha256 / length.

### 4. Docs

## Deferred (explicitly NOT in this plan)

- Birmel runtime telemetry (per-call prompt summary attached to OTel spans). Worth doing later — birmel currently has no way to prove a specific message's call included persona/glitter — but the user wants zero runtime impact in this change.

## Files touched

| Action | Path                                                                             |
| ------ | -------------------------------------------------------------------------------- |
| Create | `packages/scout-for-lol/packages/data/src/review/pipeline-stages.test.ts`        |
| Create | `packages/birmel/src/voltagent/agents/system-prompt.test.ts`                     |
| Create | `packages/birmel/src/persona/style-transform.test.ts`                            |
| Create | `packages/scout-for-lol/packages/backend/scripts/inspect-pipeline-trace.ts`      |
| Create | `packages/docs/plans/2026-05-17_prove-personality-glitter-wiring.md` (this file) |

## Verification

1. `cd packages/scout-for-lol/packages/data && bun test ./src/review/pipeline-stages.test.ts` — 2 pass
2. `cd packages/birmel && bun test ./src/voltagent/agents/system-prompt.test.ts ./src/persona/style-transform.test.ts` — 15 pass
3. `bunx tsc --noEmit` in both packages — clean
4. `bunx eslint` on each new file — clean
5. Full suites: `bun test` in `packages/scout-for-lol/packages/data` (323 pass) and `packages/birmel` (32 pass, 5 pre-existing skips)
