# ts-mc docs constraints

Starlight docs for `https://docs.ts-mc.net`. `README.md` owns the content
triage record and analytics wiring.

- Player-facing pages only. Do not reintroduce internal infrastructure
  documentation; homelab docs live in `packages/docs/wiki`.
- World border figures must match the live ChunkyBorder
  `borders.json` (`packages/homelab/src/cdk8s/config/minecraft-tsmc/`);
  recheck them when the docs change.
- Live map links go to `bluemap.ts-mc.net`; there is no
  `livemap.ts-mc.net` hostname.
- Keep the `world_downloads.md` filename: it preserves the old MkDocs URL.
- `public/posthog.js` must keep the managed snippet shape verified by
  `scripts/checks/check-analytics-sites.ts`.

```bash
bun run build
bun run typecheck
bun run lint
```
