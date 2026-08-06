---
id: reference-completed-2026-05-30-scout-discord-showcase-image
type: reference
status: complete
board: false
---

# Scout Discord Showcase Image

## Summary

Implemented a deterministic Discord-style marketing showcase image for the Scout Arena feature. The image is generated from the pinned Arena post-match report asset and wrapped in a Discord message frame with a timestamp, `APP` badge, `Scout for LoL` bot name, and embedded report preview.

## Changes

- Added a `discord-screenshot` showcase manifest kind and generated asset kind.
- Added `arena-discord` to the marketing showcase manifest, using the same S3 image and match data source as `arena-3-postmatch`.
- Added a Satori-based Discord screenshot renderer in `@scout-for-lol/report`.
- Adjusted the Discord screenshot renderer to preserve embedded image aspect ratio instead of cropping.
- Added configurable Discord embed image width via `embedImageWidth` on `discord-screenshot` manifest entries.
- Added configurable compact Discord chat rows before and after the bot embed.
- Added reference-style Discord presentation props for bot/user avatars, colored bot display names, and inline bot message text.
- Adjusted Discord timestamps to read clearly lighter and replaced letter badges with prominent circular avatar-style images.
- Updated the backend showcase generator to fetch the source PNG from S3, wrap it in the Discord frame, and emit `arena-discord.png`.
- Updated the frontend marketing page to resolve the Arena feature image from the generated showcase asset index.
- Generated `/generated/scout-showcase/arena-discord.png` and refreshed the generated showcase asset index.

## Verification

- `cd packages/scout-for-lol/packages/report && bun run typecheck`
- `cd packages/scout-for-lol/packages/report && bun run test`
- `cd packages/scout-for-lol/packages/report && bun run lint`
- `cd packages/scout-for-lol/packages/backend && bun test src/showcase/manifest.test.ts`
- `cd packages/scout-for-lol/packages/backend && bun run typecheck`
- `cd packages/scout-for-lol/packages/backend && bunx eslint src/showcase/generate.ts src/showcase/manifest.ts src/showcase/manifest.test.ts`
- `cd packages/scout-for-lol/packages/backend && AWS_PROFILE=seaweedfs bun run generate:marketing-showcase -- --manifest ../../showcase/marketing-showcase.manifest.json --out ../frontend/public/generated/scout-showcase --asset-index ../frontend/src/data/generated/scout-showcase-assets.json --bucket scout-prod`
- `cd packages/scout-for-lol/packages/frontend && bun run typecheck`
- `cd packages/scout-for-lol/packages/frontend && bun run lint`
- `cd packages/scout-for-lol/packages/frontend && PUBLIC_PINTEREST_TAG_ID=disabled PUBLIC_REDDIT_PIXEL_ID=disabled bun run build`
- Visually inspected the generated Discord screenshot PNG directly after regeneration.
