---
id: reference-completed-2026-06-19-pokemon-goal-audience-narration
type: reference
status: complete
board: false
---

# Pokémon `/goal` — encourage mid-session audience narration

## Context

The `/goal` command spawns a Codex agent that autonomously plays Pokémon Emerald on a Discord livestream. A tool to post mid-session updates **already exists** — `pokemonctl progress "<message>"` — fully wired end to end:

```
pokemonctl progress  →  POST /progress (control-server.ts)
                     →  GoalManager.publishProgress (goal-manager.ts)
                     →  sendMessage callback (pokemon-driver.ts)  →  Discord channel
```

Two problems meant it was effectively unused / misframed:

1. **Barely encouraged.** The prompt mentioned it once, passively, buried in a long TOOLS list. The model rarely narrated.
2. **Requester-oriented, not audience-oriented.** Each update was formatted `<@requester> goal update: <text>` and pinged the requester — the wrong tone for narration the livestream audience reads.

**Approach** (confirmed with user): reuse the existing `progress` tool (no new tool, no rename), strengthen the prompt to encourage occasional updates, and reformat messages as clean audience narration with no requester ping. The existing 60s throttle (`progress_update_interval_seconds`, default 60) is unchanged.

## Changes

All paths under `packages/discord-plays-pokemon/packages/backend/src/goal/`.

| File                   | Change                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex-command.ts`     | Strengthened prompt — imperative, audience-facing encouragement to post occasional updates (opening line, the `progress` tool bullet, and a new OPERATIONAL GUIDANCE bullet).               |
| `goal-manager.ts`      | `publishProgress` now posts the model's text verbatim (`truncateForDiscord(sanitizeDiscordText(trimmed))`) with `allowedUserIds: []` — no `<@requester>` mention, no `goal update:` prefix. |
| `goal-manager.test.ts` | Throttle test now asserts the clean format: content equals the narration, contains no `<@user-a>` / `goal update:`, and `allowedUserIds` is `[]`.                                           |

### Out of scope (unchanged)

- `pokemonctl.ts` — CLI verb stays `progress`.
- `control-server.ts` — route stays `/progress`, schema unchanged.
- Config — `progress_update_interval_seconds` default stays 60.
- **Completion / timeout messages** (`goal-manager.ts`) keep their `<@requester>` ping — those are end-of-session direct replies to the person who ran `/goal`, not audience narration.

## Verification

From `packages/discord-plays-pokemon/`:

- `bun run --filter='./packages/backend' test src/goal/goal-manager.test.ts` → 12 pass, 0 fail.
- `bun run typecheck` → clean (common, frontend, backend).
- `bunx eslint` on the three changed files → clean.
- Manual (not run; needs emulator + Codex creds): `/play` then `/goal "<objective>"` in a test server; confirm the bot posts clean, un-pinged narration mid-session, spaced ~1/min.

## Notes

- Production first-update behavior is already correct: `lastProgressSentAt` inits to `0` but real `now()` is a large epoch, so the first narration posts immediately and isn't throttled. (In the throttle unit test, mocked time starts at 0, so the first call is throttled there — a test artifact, not prod behavior.)

## Session Log — 2026-06-19

### Done

- Strengthened the goal prompt to encourage occasional audience narration via `pokemonctl progress` (`codex-command.ts`: opening line + the `progress` tool bullet + a new OPERATIONAL GUIDANCE bullet).
- Reformatted `GoalManager.publishProgress` to post clean, un-pinged narration (`goal-manager.ts`).
- Updated the throttle test to assert the new format (`goal-manager.test.ts`).
- Verified: backend goal tests (12 pass), full-package typecheck, and eslint on changed files all green.

### Remaining

- Open the PR (branch `feature/pokemon-goal-narration`) once the user confirms.
- Manual live check on a test Discord server (emulator + Codex creds required).

### Caveats

- Only the **mid-session** progress updates were de-pinged. Completion/timeout messages intentionally still `<@>`-mention the requester.
- The throttle remains 60s by default; if the model narrates more often, extra calls return `{ok:false, throttled:true}` and are silently dropped (by design).
