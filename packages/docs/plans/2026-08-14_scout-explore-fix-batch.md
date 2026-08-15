---
id: plan-2026-08-14-scout-explore-fix-batch
type: plan
status: in-progress
board: true
verification: agent
disposition: active
---

# Explore UI — Fix Review Findings & Fill Feature Gaps

## Context

A high-effort multi-angle code review of the Scout Explore chat surface
(`packages/scout-for-lol/packages/app`) confirmed 10 correctness findings and
surfaced feature, accessibility, and perf/reuse gaps. Full scope was chosen:
all findings, the missing chat features (share revoke, URL-addressed
conversations, timestamps, Escape-to-stop, clipboard timing), accessibility,
and perf/reuse cleanups — including a breaking wire-contract change (safe:
only app+backend consume the contract, and stage deploys are lockstep).

Verified findings being fixed (file:line citations validated):

1. Turn teardown loses answers — `finally` clears pending state before
   `refresh()` lands (explore.tsx:163-169); non-abort errors persist nothing
   (`persistPartialAnswer` refuses `!aborted`, http-route.ts:433-435); Stop
   races the post-disconnect salvage; failed questions unrecoverable.
2. Editing the root question can't fork — `parentMessageId: null` means
   "attach at current leaf" (store.ts:302-304) and the root's parentId IS null.
3. Pending stream state not conversation-keyed — switching/deleting mid-stream
   renders the stream under the wrong conversation (explore.tsx:227, 404-415).
4. Failed `explore.status` renders as access denial (explore.tsx:190-204).
5. Enter-to-send lacks the IME `isComposing` guard (explore.tsx:353-358).
6. Export table emits an empty mislabeled label column + raw values
   (explore-export.ts:41-49) and never escapes `|`/newlines.
7. setLeaf/rename/delete rejections unhandled; dialogs stick open; `isPending`
   unused (explore.tsx:305-313, 387-396, 404-415).
8. `/explore` + `/explore/s/:token` missing from `normalizePath`'s allowlist →
   all Explore pageviews tracked as `/not-found` (analytics.ts:445-447).
9. Per-token smooth `scrollIntoView` with no pinned-to-bottom guard
   (explore.tsx:97-99).
10. First question renders twice while a new conversation streams (persisted
    question + pendingQuestion, no dedup; explore.tsx:469-471).

Key verified facts the design leans on: `tree.ts` already treats
`parentId === null` messages as root siblings (versionPosition/siblingsOf);
`startExploreTurn`'s ownership check already permits a null parent; the `final`
stream event already carries the full persisted assistant message; the app's
test harness is SSR-only (`renderToStaticMarkup`, no effects/DOM); explore.tsx
sits at 499/500 ESLint max-lines and must be split; react-router `^8.3.0`;
`ReportResultTable` is structurally compatible with the explore preview
(`formatCell` handles `key === "label"` via `row.label`).

`PKG` = `packages/scout-for-lol/packages` below.

## Design decisions

- **Attach-point union replaces `parentMessageId`.** `ExploreTurnRequest`
  gains `attach: {kind:"leaf"} | {kind:"root"} | {kind:"message", messageId}`
  (default `{kind:"leaf"}`), because null currently means two different things
  and "fork at root" is inexpressible. Matches the repo's discriminated-union
  preference (LakeQueryScope precedent; `z.discriminatedUnion` already used in
  explore.ts:196). Breaking change; both sides land in one release
  (lockstep deploys). Stale tabs get a 400 until reload — accepted.
- **`started` event gains `questionMessageId`** — the freshly persisted
  question's id (existing question id for regenerate). Enables exact
  duplicate-question suppression and stop catch-up detection.
- **Salvage widens to non-abort errors.** `persistPartialAnswer` refuses only
  empty text; caveat distinguishes stopped vs interrupted via two new
  constants in `@scout-for-lol/data` (`EXPLORE_STOPPED_CAVEAT`,
  `EXPLORE_INTERRUPTED_CAVEAT`). After successful salvage on error, emit
  `final` only (single terminal event); log + Sentry-capture the swallowed
  error server-side. Function is exported with an explicit prisma client
  param as the test seam.
- **Pure turn-state module + hook.** All turn logic leaves explore.tsx:
  - `app/src/lib/explore-turn-state.ts` (pure, SSR-testable):
    `ExplorePendingTurn` (conversation-keyed: conversationId,
    questionMessageId, question, answer, activity, leafIdAtStart,
    finalMessageId, phase), `createPendingTurn`, `applyStreamEvent` (reducer;
    `final` replaces streamed text with the persisted message content),
    `markStopping`, `turnHasLanded(turn, messages)` (finalMessageId present,
    or last message is an assistant under `questionMessageId` with
    id ≠ leafIdAtStart — detects stop-salvage rows), `visiblePending(turn,
displayedConversationId, messages)` (all-null when conversation doesn't
    match; question suppressed once messages contain `questionMessageId`;
    answer suppressed once landed).
  - `app/src/hooks/use-explore-turn.ts`: owns pendingTurn/error/abortRef;
    `runTurn`, `stop`, `abortForNavigation`. Teardown order fixed: **await
    targeted refresh first, then clear pendingTurn**. Stop catch-up: bounded
    re-poll (refresh → check `turnHasLanded` → 600ms → refresh → 1500ms →
    refresh, ~2.1s cap), then clear. Pre-`started` failures call
    `restoreQuestion(text)` so the composer gets the draft back; post-started
    failures don't (question already persisted). `abortForNavigation` aborts
    (the backend allows one active run per user — backgrounding would silently
    block the next question), clears pending, schedules one delayed refresh.
- **URL is the source of truth for the active conversation.** Single route
  `explore/:conversationId?` (optional segment — avoids remounting `Explore`
  when the `started` event navigates `/explore` → `/explore/:id`;
  `router.test.ts` pins v8 optional-segment support; fallback = two sibling
  routes sharing the element). `explore/s/:shareToken` stays put. Params via
  `useExploreParams()` in route-params.ts (uuid-validated,
  `RouteParameterError` on garbage); non-blocking `exploreLoader` prefetches
  status/list/get. Sidebar select/new navigate; `started` navigates
  `replace: true`; deleting the active conversation navigates `/explore`
  `replace: true` and `removeQueries` the dead transcript.
- **Analytics**: two `.replace` templating rules (token first:
  `/^\/explore\/s\/[^/]+/` → `/explore/s/:shareToken`, then
  `/^\/explore\/(?!s(?:\/|$))[^/]+/` → `/explore/:conversationId`) + knownRoute
  alternation `\/explore(?:\/(?::conversationId|s\/:shareToken))?`. Token is
  templated before the knownRoute test, so it can never reach PostHog.
  `analyticsContextRoute` deliberately unchanged (no guild property).
- **Share flow**: `shareLink` derived from
  `transcript.data.conversation.shareToken` (kills stale-after-delete);
  `showShareLink` boolean reset on conversation change; clipboard write
  immediately after mint (before invalidation, preserving user activation),
  `typeof navigator.clipboard?.writeText === "function"` guard, refused
  clipboard = "copy manually" hint, never an error. Revoke: small ghost icon
  button (`Link2Off`, aria-label "Stop sharing") in the header when shared,
  calling existing `explore.revokeShare`.
- **Reuse swaps**: transcript preview → `ReportResultTable` (guard empty rows
  at the call site to keep null-on-empty; accept left-aligned metrics);
  query/trace disclosures → Radix `Collapsible` (free aria-expanded; triggers
  move onto their own rows); loading → `SectionSkeleton`; rollout denial →
  `ForbiddenPanel`; shared `httpErrorMessage` moves to a new
  `lib/stream-http-error.ts` parsing a tolerant `z.looseObject({error})`
  (the two strict schemas differ only in quota snapshot type).
- **Error-state fix**: `status.isError` renders an inline retry panel calling
  `status.refetch()` (narrower than RouteErrorPanel's resetQueries+navigate).
- **Composer extracted** to `explore-composer.tsx` owning `question` state:
  IME guard (`event.nativeEvent.isComposing` — combobox.tsx precedent),
  Escape-to-stop via window listener gated on active turn +
  `!event.defaultPrevented` (textarea is disabled mid-turn and can't hear
  keys; guard defers to Radix dialogs), focus returned to the textarea on
  active→idle, draft restore only into an empty box, JS autosize kept
  (Firefox lacks `field-sizing`) with the 200px constant hoisted.
- **Perf**: memoized `UserTurn`/`AssistantTurn`/`ExploreSidebar`
  (`export const X = memo(XView)` convention); single memoized
  `actions` object prop; pending stream rendering isolated in a memoized
  `PendingTurn` leaf with `aria-live="polite"` (always mounted) so deltas
  re-render only it; transcript root gets `role="log"`; pinned auto-scroll via
  `use-pinned-scroll.ts` (window is the scroll container — verified; passive
  scroll listener, 120px threshold, `block:"end"` auto behavior, never yanks a
  scrolled-up reader); targeted invalidation
  (`get.queryKey({conversationId})` + list; delete uses removeQueries);
  ECharts init/dispose effect split from a `setOption(..., {notMerge:true})`
  effect keyed on the snapshot.
- **Timestamps**: assistant turns only — `<time dateTime>` with short
  `Intl.DateTimeFormat` text and full-format `title`, no date library.
- **Export**: label column heads the table (`labelColumn?.label ?? "Row"`),
  metric values through `formatReportDisplayValue`, `escapeCell` (`\|`,
  newlines→space) on headers/cells, heading newline collapse for title and
  questions, `exportFilename` slices before stripping hyphens,
  `downloadMarkdown` appends the anchor to the DOM and revokes the object URL
  on a 0-ms timeout.

## Implementation phases

Single git-spice stack from this worktree branch; draft PR after phase 1's
first coherent commit. Mirror this plan to
`packages/docs/plans/2026-08-14_scout-explore-fix-batch.md` (canonical
frontmatter) in the first commit.

### Phase 1 — Contract + backend (PKG/data, PKG/backend)

1. `data/src/model/explore.ts`: add `ExploreAttachPointSchema` +
   `ExploreAttachPoint`; rewrite `ExploreTurnRequestSchema` (drop
   `parentMessageId`, add `attach`, update the semantics docblock table:
   Ask=leaf, Edit non-root=message(parent), Edit root=root,
   Regenerate=message(question)); add `questionMessageId: z.uuid()` to the
   `started` event; add the two caveat constants.
2. `backend/src/explore/store.ts` `startExploreTurn`: input takes
   `attach: ExploreAttachPoint`; existing-conversation branch resolves
   parentId via the 3-way kind switch; `kind:"message"` ids must exist in the
   conversation (`ExploreNotFoundError`); new-conversation branch ignores
   attach. No tree.ts changes needed.
3. `backend/src/explore/http-route.ts`: `resolveTurnTarget` — regenerate
   requires `attach.kind === "message"` (else `ExploreInvalidTurnError`
   "Answering again needs an existing question."); pass `attach` through;
   `started` emit gains `questionMessageId: started.messageId`;
   `persistPartialAnswer` exported with explicit prisma param, refuses only
   empty text, caveat by `input.aborted`; log + `Sentry.captureException` the
   non-abort error in the catch.
4. Tests: adapt `store.integration.test.ts` `askAndAnswer` to `attach`; new
   "editing the opening question forks a second root" (two roots,
   versionCount 2, siblingIds, setLeaf restores the original path, nothing
   deleted); `http-route.e2e.test.ts` — drop stale `parentMessageId: null`
   bodies, new "a regenerate that names no message is rejected as invalid",
   new "explore salvage" describe driving exported `persistPartialAnswer`
   (stopped-with-text → stop caveat; errored-with-text → interrupted caveat +
   currentLeafId moves; errored-empty → null, nothing written). No
   `streamExploreAgent` mock (emit-ordering residue accepted; documented).
5. Docs: AGENTS.md Explore bullets — attach-point semantics + salvage-on-error.

### Phase 2 — Turn lifecycle + URL routing (PKG/app)

1. New `src/lib/explore-turn-state.ts` (pure module above) + full test file
   `explore-turn-state.test.ts` (10 cases from the design: reducer, landed
   predicate incl. regenerate/leafIdAtStart, visiblePending suppressions,
   null↔null conversation match). Fixtures via `ExploreMessageSchema.parse`.
2. New `src/hooks/use-explore-turn.ts` (behavior above; targeted refresh:
   invalidate `get.queryKey({conversationId})` + `list.queryKey()`).
3. Routing: `router.tsx` route becomes
   `{ path: "explore/:conversationId?", element: <Explore/>, loader:
exploreLoader, errorElement: <RouteErrorPanel/> }`; `route-params.ts` gains
   `ExploreParamsSchema`/`useExploreParams`; `route-loaders.ts` gains
   `exploreLoader` (prefetch status/list/get, safeParse id);
   `router.test.ts` KNOWN_URLS += `/explore`, `/explore/<uuid>`,
   `/explore/s/some-share-token`.
4. `routes/explore.tsx` rewrite (lands well under 500 lines): conversationId
   from `useExploreParams()` (hook takes `conversationId ?? null`);
   `onConversationStarted: navigate(`/explore/${id}`, {replace:true})`;
   sidebar handlers `abortForNavigation()` + navigate; delete handler aborts
   if streaming, navigates `/explore` replace, `removeQueries` the dead get
   key; ask/edit/regenerate call sites send `attach` ({kind:"leaf"} /
   parentId===null ? root : message / message(parentId)); `visiblePending`
   feeds the transcript; status branches: `SectionSkeleton` → isError retry
   panel (`status.refetch()`) → `ForbiddenPanel` rollout copy; named
   `handleSelectVersion`/`handleRename`/`handleDelete` useCallbacks with
   try/catch → setError, dialogs close on success only,
   `pending={mutation.isPending}` wired; memoized `transcriptActions`.

### Phase 3 — Components, share, export, analytics, perf (PKG/app)

1. `explore-transcript.tsx`: props take `actions?: ExploreTranscriptActions`
   (module-level `EMPTY_ACTIONS` fallback); `role="log"` container; memoized
   `PendingTurn` live-region leaf; memoized UserTurn/AssistantTurn;
   `ReportResultTable` swap (delete `PreviewTable` + unused imports; empty-rows
   guard at call site); Collapsible disclosures for query + steps
   (ChevronDown rotate pattern); `<time>` on assistant action rows. New SSR
   test `explore-transcript.test.tsx` (6 cases from the design: log+live
   region always mounted, streaming content in region, time element,
   dimension-label header + formatted metrics, empty-preview omission,
   aria-expanded false).
2. New `src/components/explore-composer.tsx` (IME guard, Escape listener,
   focus return, draft restore, autosize constant). New
   `src/hooks/use-pinned-scroll.ts`; page effect replaces the old
   scrollIntoView effect.
3. Share: new `src/hooks/use-explore-share.ts` (derived link, copy-first,
   revoke) + `src/components/explore-share.tsx` (link row + copied/manual
   hint); `explore-header.tsx` actions gain `revoking`/`onRevoke` + Link2Off
   button.
4. New `src/lib/stream-http-error.ts`; `report-ai-stream.ts` and
   `explore-stream.ts` consume it (delete both private copies; explore's
   `attach`-carrying request type flows from the data package unchanged).
5. `explore-export.ts` fixes + new `explore-export.test.ts` (6 cases from the
   design). `explore-shared.tsx` swaps loading text for `SectionSkeleton`.
6. `analytics.ts` replace-chain + knownRoute edits (verbatim regexes in the
   design); `analytics.test.ts` two new cases ("templates explore conversation
   ids", "never lets a share token reach PostHog").
   `router-analytics-identity.test.ts` must pass untouched.
7. `interactive-visualization.tsx` effect split (`notMerge: true`; Zod parse
   stays in the option effect). `explore-sidebar.tsx` wrapped in `memo`.

## Verification

- Per-package while iterating:
  `bunx turbo run typecheck test lint --filter=@scout-for-lol/data --filter=@scout-for-lol/backend --filter=@scout-for-lol/app`
- Focused suites: backend `bun test src/explore/` (store integration needs the
  test DB harness); app `bun test src/lib/explore-turn-state.test.ts
src/lib/explore-export.test.ts src/lib/analytics.test.ts src/router.test.ts
src/router-analytics-identity.test.ts src/components/explore-transcript.test.tsx`.
  `router.test.ts` is the canary for react-router v8 optional segments.
- Root `bun run knip` (moved/deleted exports, new modules).
- Manual end-to-end (SSR tests can't run effects):
  `EXPLORE_GUILD_ALLOWLIST=<guild id> bun run --filter='./packages/scout-for-lol' dev:web`,
  then `toolkit screenshot scout-app /app/explore --discord-id <allowlisted id>`
  and `/app/explore/<conversation uuid>`. Eyeball: URL updates on
  select/new/started + Back behaves; deep link renders; edit the OPENING
  question → version arrows `‹1/2›` appear on turn 1; Stop mid-answer → prose
  survives with the stopped caveat; kill the backend mid-answer → prose
  survives with the interrupted caveat + composer regains the draft on
  pre-start failure; share → link row + Copied ack; revoke flips back to
  Share; export downloads a correct, escaped table; chart survives turn
  refetches without flicker; Escape stops; focus returns to composer;
  scrolled-up reading is never yanked; timestamps render; disclosures
  animate with chevron + aria-expanded. IME Enter needs a real CJK input
  source — manual spot check.
- PR artifacts (repo rule for user-visible changes): short GIF of
  edit-root forking + Stop-preserves-answer; screenshot of the share/revoke
  header states. Upload via `toolkit pr asset`.
- After merge: re-report the review findings with outcomes (ReportFindings).

## Risks

- Breaking wire change: stale SPA tabs 400 until reload (lockstep deploys;
  accepted; no dual-read shim unless reports surface).
- Salvage now keeps possibly-mid-sentence prose on errors — mitigated by the
  interrupted caveat; deliberate trade against losing the answer.
- Stop catch-up is bounded (~2.1s); a slower salvage appears on the next
  natural refetch.
- Hook async behavior isn't SSR-testable — that's why every decision lives in
  the pure `explore-turn-state.ts` layer.
- react-router v8 optional-segment assumption pinned by router.test.ts with a
  named two-route fallback.
