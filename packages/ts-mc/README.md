# ts-mc.net portal

Astro site for `https://ts-mc.net`, the front door of The Storm Minecraft
server. Currently a portal (hero, server address, destination rows); the
`src/{pages,components,layouts,styles}` structure is meant to grow into a
fuller marketing site.

## Brand

Storm identity ported from `the-storm-mc/monorepo`: teal `#00d0c6`, dark
`#303030`/`#101010`, white. Logos and art live in `public/`:

- `logo.svg` / `logo-full.svg` — wordmark
- `logo-square.svg` — square mark
- `favicon.svg`, `bg.jpg` (hero backdrop), `social.png` (og-image)

Theme tokens are defined in `src/styles/global.css` (`@theme`).

## Analytics

`public/posthog.js` is the managed PostHog snippet, wired in
`src/layouts/BaseLayout.astro` and verified by
`scripts/checks/check-analytics-sites.ts` (registry key `ts-mc`). Keep the
snippet byte-comparable with the other static trackers when updating it.

## Develop

```bash
bun run dev
bun run build
bun run typecheck
bun run lint
```

Deploys via `bun run deploy` (SeaweedFS `ts-mc` bucket) and the `sites` CI
lane on `main`.
