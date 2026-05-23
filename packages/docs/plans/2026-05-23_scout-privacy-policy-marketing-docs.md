# Scout Privacy Policy Marketing and Documentation Use

## Status

Complete

## Summary

Update Scout's public privacy policy to disclose that all data collected by the app may be used for marketing and documentation purposes, and add a What's New entry announcing the policy clarification.

## Implementation Plan

- Update `packages/scout-for-lol/packages/frontend/src/pages/privacy.mdx`.
- Refresh the policy date to `May 23, 2026`.
- Add marketing/documentation use to the table of contents and policy body.
- State that all collected data may be used for marketing and documentation, including Discord information, League account and match data, usage data, commands, logs, bot interaction data, generated images, reports, graphs, charts, and other generated artifacts.
- Preserve the existing "we never sell your data" promise.
- Adjust "Aggregated data" and "No Advertising or Cookies" wording so they do not contradict broad marketing/documentation reuse.
- Add a new top entry in `packages/scout-for-lol/packages/frontend/src/data/changelog.tsx` dated `2026 05 23` with a concise "Privacy policy update" banner and a `Privacy` changelog section explaining that Scout clarified how collected data and generated report artifacts may be used for marketing and documentation.
- Do not change Terms of Service unless implementation reveals a direct contradiction.

## Test Plan

- Run `bun run --filter='./packages/frontend' typecheck`.
- Run `bun run --filter='./packages/frontend' lint`.
- Manually inspect `/privacy` and `/whatsnew` copy for internal consistency.

## Session Log — 2026-05-23

### Done

- Updated `packages/scout-for-lol/packages/frontend/src/pages/privacy.mdx` with a May 23, 2026 policy date, a marketing/documentation table-of-contents item, and explicit broad-use wording for all collected data and generated artifacts.
- Updated `packages/scout-for-lol/packages/frontend/src/data/changelog.tsx` with a May 23, 2026 What's New entry for the privacy policy clarification.
- Installed locked dependencies and generated Scout backend Prisma artifacts needed for local verification in this fresh worktree.
- Verified with `bun run --filter='./packages/frontend' typecheck` and `bun run --filter='./packages/frontend' lint`.
- Addressed PR review feedback by removing duplicate no-sale wording and clarifying that users can object to or restrict marketing and documentation use where applicable.
- Re-verified the review update with `bun run --filter='./packages/frontend' typecheck` and `bun run --filter='./packages/frontend' lint`.

### Remaining

- No requested work remains.

### Caveats

- This is a policy copy update, not legal review.
- Verification emits existing Astro and parser hints, but both planned commands exit successfully.
