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

Plan copied here per [AGENTS.md Documentation Discipline](../../../CLAUDE.md). Session log appended below.

## Deferred (explicitly NOT in this plan)

- Birmel runtime telemetry (per-call prompt summary attached to OTel spans). Worth doing later — birmel currently has no way to prove a specific message's call included persona/glitter — but the user wants zero runtime impact in this change.

## Files touched

| Action     | Path                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Create     | `packages/scout-for-lol/packages/data/src/review/pipeline-stages.test.ts`                                                                              |
| Create     | `packages/birmel/src/voltagent/agents/system-prompt.test.ts`                                                                                           |
| Create     | `packages/birmel/src/persona/style-transform.test.ts`                                                                                                  |
| Create     | `packages/scout-for-lol/packages/backend/scripts/inspect-pipeline-trace.ts`                                                                            |
| Fix (data) | `packages/birmel/src/persona/style-cards/virmel_style.json` — `summary` array → single string (default persona was silently disabled, see Session Log) |
| Create     | `packages/docs/plans/2026-05-17_prove-personality-glitter-wiring.md` (this file)                                                                       |

## Verification

1. `cd packages/scout-for-lol/packages/data && bun test ./src/review/pipeline-stages.test.ts` — 2 pass
2. `cd packages/birmel && bun test ./src/voltagent/agents/system-prompt.test.ts ./src/persona/style-transform.test.ts` — 15 pass
3. `bunx tsc --noEmit` in both packages — clean
4. `bunx eslint` on each new file — clean
5. Full suites: `bun test` in `packages/scout-for-lol/packages/data` (323 pass) and `packages/birmel` (32 pass, 5 pre-existing skips)

## Session Log — 2026-05-17

### Done

- New unit test `packages/scout-for-lol/packages/data/src/review/pipeline-stages.test.ts` (2 tests, 19 expects) asserts personality instructions, style card author marker, `glitter-boys-history.txt` content, `digraph` + relationship node, and reviewer/player names all appear in the rendered Stage-2 system prompt. Also asserts the trace's captured `systemPrompt` is byte-identical to what the LLM saw.
- New unit test `packages/birmel/src/voltagent/agents/system-prompt.test.ts` (9 tests, 43 expects) covers `buildPersonaBlock`, `buildSupervisorPrompt`, `buildSubAgentPrompt` for both populated and null persona, plus a sanity check that the bundled glitter history + graph load correctly.
- New unit test `packages/birmel/src/persona/style-transform.test.ts` (6 tests, 44 expects) loops every shipped style card through `StyleCardSchema`, exercises `buildStyleContext` + `buildPersonaPrompt` for the default persona, and verifies missing-persona returns `null` (the silent-skip path).
- New CLI `packages/scout-for-lol/packages/backend/scripts/inspect-pipeline-trace.ts` reads a pipeline trace from S3 by matchId and prints detected personality, `hasGlitterHistory`/`hasRelationshipGraph` flags, content previews, plus the prompt sha256 and length.
- **Bug fix surfaced by the new test:** `packages/birmel/src/persona/style-cards/virmel_style.json` had `summary` as a 3-element string array instead of a single string. Birmel's `StyleCardSchema` (`summary: z.string()`) silently rejected it, which means `buildStyleContext("virmel")` returned `null` for the **default persona** of every guild — so every birmel agent in production has been running with **no persona block** at all. Joined the 3 paragraphs into one string. This is a small runtime behavior change (persona block now actually injects for virmel guilds) but it's the explicit fix for what the tests were designed to detect.

### Remaining

- None for the agreed scope. The user explicitly deferred runtime observability changes in birmel (per-call OTel attributes that would prove every individual message in production included persona + glitter). If they want that next, the entry point is `packages/birmel/src/voltagent/agents/routing-agent.ts:64` and the 6 specialized sub-agent files; a `summarizePrompt()` helper next to `buildPersonaBlock` could compute `{ personaName, hasGlitterHistory, hasRelationshipGraph, promptSha256, lengthChars }` and attach those as span attributes via `tracing.ts`.

### Caveats

- The scout `inspect-pipeline-trace.ts` CLI talks to the same S3 bucket the bot writes to (`S3_BUCKET_NAME`). It defaults to scanning the last 30 days when `--date` isn't supplied, which on a busy bucket is non-trivial — pass `--date YYYY-MM-DD` for a single-day prefix when possible.
- The virmel JSON fix is the only behavioral change in this PR; it does not change the schema or any code path. If reverting that one file is desired, the test that loops all style cards will fail loudly.
- Birmel's existing observability (OTel → Tempo) records duration + Discord IDs only — it cannot retroactively prove a specific past message included persona/glitter content. Use scout's S3 traces for that proof in scout, and the new tests for both packages as the structural guarantee.
