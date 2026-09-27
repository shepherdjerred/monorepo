# ts-mc portal constraints

Astro portal for `https://ts-mc.net`. `README.md` owns the brand inventory
and analytics wiring.

- Keep the Storm brand tokens (`#00d0c6` / `#101010` / white) in
  `src/styles/global.css` `@theme`; do not drift per-component colors.
- The server address shown on the page must match the live SRV-backed apex
  (`ts-mc.net`). Live map links go to `bluemap.ts-mc.net`; there is no
  `livemap.ts-mc.net` hostname.
- `public/posthog.js` must keep the managed snippet shape verified by
  `scripts/checks/check-analytics-sites.ts`.
- No remote runtime scripts or fonts; the page must render fully
  self-contained apart from PostHog.

```bash
bun run build
bun run typecheck
bun run lint
```
