---
id: plan-2026-08-15-scout-explore-conversation-ux
type: plan
status: complete
board: false
---

# Explore: fix the conversation UX

## Context

`/app/explore` shipped in #2163 and was overhauled in #2179. Driving it live for
the first time (which required building a dev-only auth bypass — see §6) surfaced
one backend crash, two state bugs that corrupt a conversation, and a set of
layout and rendering problems that make the surface read as fragments rather than
a conversation.

Two of these are not cosmetic:

- Every mid-turn client disconnect throws an **unhandled promise rejection** in
  the backend.
- Switching conversations mid-turn **permanently orphans** the question — no
  answer, no caveat, no error, no retry.

Both were hit within minutes of real use. Everything here was reproduced against
a local stack with a real 6,320-match report lake, not inferred from reading.

## 1. Backend: the SSE controller crash

**File:** `packages/backend/src/explore/http-route.ts`

`emit()` guards on a local `closed` flag that is only set in the `finally`:

```ts
const emit = (event) => { if (closed) return; controller.enqueue(...) }
const abortFromRequest = () => { abortController.abort("Client disconnected."); }  // never sets closed
} finally { ...; emit({ type: "done" }); closed = true; controller.close(); }
```

When the **client** disconnects the runtime closes the controller, the run
unwinds, and the `finally`'s `emit({type:"done"})` enqueues into a dead
controller → `TypeError: Invalid state: Controller is already closed`. `emit` is
`void` inside an async IIFE, so it escapes as an unhandled rejection.

**Fix:** set `closed = true` inside `abortFromRequest` (and in the stream's
`cancel`). The flag must mean "this stream can no longer accept writes", not
"we chose to close it". Suppressing emits must **not** short-circuit the salvage
write — `persistPartialAnswer` runs before the `finally` and must still run.

**Test:** `src/explore/http-route.e2e.test.ts` already exercises the abort path
(`explore salvage`, `aborted: true`). Add a case that aborts the _request_ and
asserts (a) no unhandled rejection, (b) the partial answer is still persisted.

## 2. Client: the question renders twice

**File:** `packages/app/src/lib/explore-turn-state.ts` (`visiblePending`)

Dedup keys only on `questionMessageId`, which arrives with `started`. But the
server persists the question row **before** it opens the stream (stated in
`salvageRefreshDelays`'s own docblock). Any transcript refetch landing in that
window renders the question from `messages` _and_ from `pendingQuestion`.

**Fix:** decide persistence from `leafIdAtStart`, not from the id — a user
message positioned after `leafIdAtStart` is this turn's question. This mirrors
the heuristic `turnHasLanded` already uses for the answer, so both halves of the
turn resolve the same way.

**Test:** `packages/app/src/lib/explore-turn-state.test.ts` — pure function,
existing suite. Cover: question persisted before `started` arrives; regenerate
(no question); a prior user message must not be mistaken for this turn's.

## 3. Client: switching conversations orphans the turn

**File:** `packages/app/src/hooks/use-explore-turn.ts`

`abortForNavigation` clears `turnRef` synchronously, so `runTurn`'s `finally`
skips `awaitSalvage` by design:

> "Null here also means `abortForNavigation` abandoned the turn — its
> conversation left the screen, so no salvage catch-up either."

That reasoning is right for _rendering_ and wrong for _persistence_. The
conversation you left keeps a question with nothing under it, forever.

**Fix:** capture the abandoned turn before clearing the ref and run the bounded
salvage refresh against **its** conversation id. `refreshConversation` only
invalidates that id's query cache, so it cannot render into the conversation now
on screen. Combined with §1 the server-side partial is actually written, so the
refresh has something to find.

**Test:** extend `explore-turn-state.test.ts` for the pure predicate, and assert
in the e2e route test that a disconnect mid-stream leaves a caveated partial
rather than a bare question.

## 4. Conversation titles

**Files:** `packages/data/src/model/reports/explore.ts`, `packages/backend/src/explore/`
(`store.ts`, `agent.ts`, `prompt.ts`)

`titleFromQuestion` uses the opening question verbatim, capped at 120 chars —
but the rail is `w-60`, so CSS truncates at ~30. Two questions with a shared
prefix become identical, unpickable rows. This is the "first words of the first
message" strategy; ChatGPT uses an LLM summary instead.

**Fix — no extra completion:** add `title` to `ExploreAnswerSchema`, **after
`answer`**. `answer` must stay the first field or streaming silently stops
(pinned by `explore/stream.test.ts`); appending a field is safe. The agent
already runs structured output after answering, so it titles from the whole
first exchange — better input than ChatGPT's first-message-only approach, at
zero extra model calls.

- Keep `titleFromQuestion` as the **immediate placeholder** so the sidebar is
  never empty mid-stream (LibreChat's pattern), then replace it when the first
  turn completes.
- Apply **only** while the conversation still holds its placeholder, so titles
  don't churn on every follow-up and a manual rename is never overwritten.
- Reuse the existing rename path in `store.ts` (`data: { title }`).
- Cap short (~6 words) in `prompt.ts`.

## 5. Layout and rendering

| #   | Problem                                                                                                                                         | File                                                | Fix                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 5.1 | No `max-w`/padding; ~150ch lines, content flush to viewport edge. `explore-shared.tsx` renders the _same_ transcript at `mx-auto max-w-3xl p-6` | `routes/explore.tsx`                                | Page container matching `guild-workspace.tsx` (`mx-auto max-w-6xl px-4 py-8`), transcript capped ~`max-w-3xl` |
| 5.2 | Flat `space-y-6` spaces a question from its own answer exactly as from an unrelated exchange — no Q→A grouping                                  | `components/explore-transcript.tsx`                 | Group each exchange; tight within, loose between                                                              |
| 5.3 | Composer scrolls off-screen                                                                                                                     | `routes/explore.tsx`                                | Sticky composer                                                                                               |
| 5.4 | Sidebar scrolls away with the document; its `h-full`/`overflow-y-auto` are inert because the _document_ scrolls                                 | `routes/explore.tsx`                                | `sticky` + own scroll container                                                                               |
| 5.5 | Scalar answers render as a full-width 2-column table with a degenerate `ALL`/`All` label column                                                 | `explore-transcript.tsx`, `report-result-table.tsx` | Stat tile for single-row/degenerate-group previews                                                            |
| 5.6 | Caveats — the content that stops someone quoting a wrong number — are the least prominent text                                                  | `explore-transcript.tsx`                            | Distinct treatment, not muted micro-text                                                                      |
| 5.7 | `‹ 2/2 ›` version switcher is near-invisible                                                                                                    | `explore-transcript.tsx`                            | Raise contrast/affordance                                                                                     |
| 5.8 | Edit pencil always visible, floating in dead space under every user bubble                                                                      | `explore-transcript.tsx`                            | Reveal on hover/focus, anchored to the bubble                                                                 |
| 5.9 | `explore.status` returns `quota`; Explore never reads it. `report-ai-editor.tsx:317` already renders quota properly                             | `routes/explore.tsx`                                | Surface quota, reusing that pattern                                                                           |

Keep `explore-shared.tsx` visually consistent — it renders the same components,
so §5.2/5.5–5.8 land there too. `explore-transcript.test.tsx` covers SSR.

## 6. Dev tooling (written, uncommitted)

`DEV_USER_GUILDS` — dev-only stand-in for Discord membership, since a dev-login
session has no OAuth token and `/app/explore` is otherwise unreachable without a
manual click-through. Gated on `environment === "dev"` **AND** `enableDevLogin`
**AND** a non-empty list; each condition fails closed alone. Already implemented
with refusal tests in `discord-rest.test.ts` and documented in
`packages/scout-for-lol/AGENTS.md` (which previously claimed no such bypass
existed — corrected to "no _blanket_ bypass").

Folds into the same commit per your call.

## Verification

```bash
bunx turbo run typecheck lint test --filter=@scout-for-lol/backend \
  --filter=@scout-for-lol/app --filter=@scout-for-lol/data
```

Then drive it live — the bugs here are behavioural and only a real session shows
them:

```bash
DEV_USER_GUILDS=<guild-id> EXPLORE_GUILD_ALLOWLIST=<guild-id> AWS_PROFILE=seaweedfs \
  bun run --filter='./packages/scout-for-lol' dev:web
# then http://localhost:5180/api/dev/login?discordId=<id>&returnTo=/app/explore
```

Manual checks, each mapped to the bug it proves:

1. Ask in a new conversation → question appears **once**; sidebar title becomes a
   short summary, not the truncated question (§2, §4).
2. Ask, then immediately switch conversations → the conversation you left holds a
   caveated partial answer, not a bare question; **no unhandled rejection** in
   the server log (§1, §3).
3. Ask, then close the tab mid-stream → same, from the log side (§1).
4. Long conversation → composer and sidebar stay put while scrolling (§5.3–5.4).
5. Ask a scalar question ("how many matches are in the data?") → stat tile, no
   `ALL`/`All` table (§5.5).
6. Regenerate → version switcher is noticeable (§5.7).
7. Share the conversation → the shared page matches the live page (§5).

Watch `/tmp/scout-dev.log` for `Controller is already closed` throughout; it
should never appear. Note the dev server must be launched detached (`nohup`) or
background-task teardown kills it between steps.

## Risks

- **`answer` must stay the first field** of `ExploreAnswerSchema` — a reorder
  stops streaming silently. `explore/stream.test.ts` pins this; do not weaken it.
- §3's fix must not let a stale stream's refresh render into the conversation now
  on screen — the `seq` ownership check in `use-explore-turn.ts` exists for
  exactly this and must be preserved.
- The `attach` union (`leaf`/`root`/`message`) is a wire contract shared by app
  and backend; §2's change is client-only and must not touch it.
