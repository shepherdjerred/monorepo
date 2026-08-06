---
id: reference-completed-2026-05-23-scout-marketing-news-update
type: reference
status: complete
board: false
---

# Scout Marketing News Update

## Summary

Update the Scout for LoL marketing site with a new release/news entry and a light homepage refresh for recent Scout improvements:

- Prematch inferred lane order for Summoner's Rift loading screens.
- Draft and ranked post-match reports showing champion icons.
- Current Arena support for 18-player, six-team, teams-of-3 Arena.
- Scheduled SQL-style `/report` commands.

## Implementation Plan

- Add a current top entry to the data-driven changelog in `packages/scout-for-lol/packages/frontend/src/data/changelog.tsx`.
- Refresh homepage feature copy in `packages/scout-for-lol/packages/frontend/src/pages/index.astro` for prematch ordering, post-match champion icons, Arena teams of 3, and scheduled reports.
- Use existing committed site assets where possible, and add the available Arena screenshot from the user-provided local image path if it works cleanly in the public frontend asset directory.

## Test Plan

- `cd packages/scout-for-lol && bun run --filter='./packages/frontend' typecheck`
- `cd packages/scout-for-lol && bun run --filter='./packages/frontend' lint`
- `cd packages/scout-for-lol && bun run --filter='./packages/frontend' build`
- Start the Astro dev server and visually inspect `/` and `/whatsnew`.

## Assumptions

- "Report feature" refers to the scheduled SQL-style reports shipped in `4fc179b72 feat(scout-for-lol): add scheduled SQL reports`.
- The homepage refresh should stay targeted, not become a full site redesign.
