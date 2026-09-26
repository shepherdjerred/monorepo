# ts-mc.net docs

Starlight site for `https://docs.ts-mc.net`, the player-facing
documentation of The Storm Minecraft server. Content was ported from
`the-storm-mc/monorepo` with the internal section pruned (it described
decommissioned OVH/Netlify-era infrastructure).

## Content

Player-facing pages only: welcome, norms, world downloads, and the
survival section. Accuracy fixes applied during the port:

- Live map page rewritten for BlueMap at `bluemap.ts-mc.net` (was Dynmap
  at `livemap.ts-mc.net`, which no longer exists).
- World borders corrected against the live ChunkyBorder config
  (`packages/homelab/src/cdk8s/config/minecraft-tsmc/`): Overworld
  20,000, Nether 5,000, End 2,500. The stale Amplified section was
  dropped.
- The dated world-download table was dropped; no snapshots have been
  published.
- The empty `legacy.md` stub was dropped.

The `world_downloads.md` filename is intentionally underscore-delimited:
it preserves the old MkDocs URL (`/world_downloads/`).

## Brand

Storm identity: teal `#00d0c6`, dark `#303030`/`#101010`, white.
Starlight accent overrides live in `src/styles/custom.css`; the mark is
`src/assets/storm-mark.svg`.

## Analytics

`public/posthog.js` is the managed PostHog snippet, wired in
`astro.config.ts` and verified by
`scripts/checks/check-analytics-sites.ts` (registry key `ts-mc-docs`).

## Develop

```bash
bun run dev
bun run build
bun run typecheck
bun run lint
```

Deploys via `bun run deploy` (SeaweedFS `ts-mc-docs` bucket) and the
`sites` CI lane on `main`.
