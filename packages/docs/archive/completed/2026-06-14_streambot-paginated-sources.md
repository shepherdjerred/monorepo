---
id: reference-completed-2026-06-14-streambot-paginated-sources
type: reference
status: complete
board: false
---

# Paginated `/stream sources` — exploration-friendly source browser

## Context

`/stream sources` currently dead-ends past the first 20 matches: it filters by a `query` substring, slices to `MAX_SOURCES = 20`, and appends `…and N more`. To explore yt-dlp's ~500 supported sites a user has to keep guessing query strings — there's no way to _browse_.

The fix is to make the result paginated. The user's framing ("easily explore") points at interactive Prev/Next buttons rather than a `page:` arg that forces the user to re-type the command each time.

## Approach — interactive button pagination on the ephemeral reply

- Prev / Next buttons (with First / Last when there are >5 pages) on the ephemeral `/stream sources` reply.
- Page footer: `Page X of Y · N sources` (and `… matching \`<query>\`` when filtered).
- 5-minute message-component collector scoped to the invoking user; after timeout the buttons are removed (message text stays).
- The existing `query` filter is preserved and paginates over the _filtered_ set.
- Calling bare (no query) now shows page 1 of all sources instead of just a count + highlights — which is the actual win for exploration.

This mirrors the production pagination pattern in `packages/scout-for-lol/packages/backend/src/discord/commands/competition/list.ts` (`buildPaginationButtons` + `createMessageComponentCollector` + `buttonInteraction.update`).

### Architectural choice — keep the handler discord.js-free

`CommandInteraction` in `command-handler.ts:111-122` is deliberately a minimal, string-only surface so the handler can be unit-tested with a fake. Rather than dragging discord.js into the handler, **extend the surface with one new method** and put the components/collector logic in the adapter:

```ts
// command-handler.ts — added to CommandInteraction
replyPaginated: (payload: {
  readonly pages: readonly string[]; // one Discord-message-sized chunk per page
  readonly header: string; // e.g. "📡 **523 sources** — page 1/18"
}) => Promise<void>;
```

The handler builds pure page strings; the adapter renders buttons + drives the collector. Unit tests stay fast and discord.js-free.

## Files to change

| File                                                | Change                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/streambot/src/discord/help-text.ts`       | Replace `sourcesText(sources, query): string` with `sourcesPages(sources, query): { header, pages }`. Drop `MAX_SOURCES`; introduce `SOURCES_PER_PAGE = 30`. Bare call now paginates all sources, not the count+highlights blurb (move the "popular / login-only won't work" guidance into the first page footer or keep it on `/stream help`).                                                    |
| `packages/streambot/src/discord/command-handler.ts` | Add `replyPaginated` to the `CommandInteraction` type. Update `handleSources` to call it: `await interaction.replyPaginated(sourcesPages(sources, query))`. No other handlers change.                                                                                                                                                                                                              |
| `packages/streambot/src/discord/command-bot.ts`     | Implement `replyPaginated` in `adapt()`. Uses `ActionRowBuilder<ButtonBuilder>`, `MessageFlags.Ephemeral`, `interaction.fetchReply()`, `createMessageComponentCollector({ componentType: ComponentType.Button, time: 300_000, filter: i => i.user.id === interaction.user.id })`, and `buttonInteraction.update({ content, components })`. On `end`, edit the message to remove the row.           |
| `packages/streambot/test/command-handler.test.ts`   | Extend the fake `CommandInteraction` with `replyPaginated` capturing `{ header, pages }`. Replace the 3 existing `sources` tests with: (a) bare = paginated full list, page 1 shows the first 30 entries, page count is correct; (b) filtered = all pages contain only matches; (c) empty match = single page with `No sources matching` text. Drop the now-obsolete `sourcesText truncates` test. |

### Functions / patterns to reuse

- **Pagination structure**: copy the button-building approach from `packages/scout-for-lol/packages/backend/src/discord/commands/competition/list.ts` (`buildPaginationButtons`, lines ~289-332) — same custom-id scheme (`sources_first` / `sources_prev` / `sources_next` / `sources_last`), same disabled-edge logic.
- **Collector pattern**: same file, the `createMessageComponentCollector` + `collect` + `end` block (~lines 127-198). Filter by `interaction.user.id` so other users can't drive someone else's pager.
- **Source data**: no change — `listExtractors()` in `packages/streambot/src/sources/ytdlp.ts:245-271` is already memoized; `handleSources` still calls `deps.listSources()` once per invocation.

### Page-size sanity

- ~500 sources → ~17 pages at 30/page. Discord ephemeral text limit is 2000 chars; 30 backtick-wrapped names joined with `·` is well under that (~600 chars + header).
- Filtered results often fit on one page → buttons should auto-hide (don't render the row) when `pages.length === 1`.

## Verification

1. **Unit tests** — `cd packages/streambot && bun test test/command-handler.test.ts` (the updated `describe("sources", ...)` block).
2. **Typecheck + lint** — `bun run --filter='./packages/streambot' typecheck` and `cd packages/streambot && bunx eslint . --fix`.
3. **Local end-to-end against the test Discord** — bring up streambot with the test config from memory `project_streambot_e2e_test_server.md`, run `/stream sources` (bare) and `/stream sources query:twitch`, click through Prev/Next/First/Last, confirm:
   - buttons greyed at edges
   - non-invoker click is rejected (ephemeral "not for you" reply)
   - 5-minute timeout removes the row but leaves text
   - filtered single-page result renders without buttons
4. **Screenshot in PR** — bare + filtered states, per the global "show visual changes" rule.
