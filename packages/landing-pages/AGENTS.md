# Landing pages constraints

Static Astro site for `https://pages.sjer.red`, the shared host for landing and
campaign pages across projects. `README.md` owns the item layout and the
tracking contract.

- Each item is a top-level route (`src/pages/<item>/`) with its own layout,
  styles, fonts and assets under `src/items/<item>/`. Items do not share design.
- Every page goes through `src/layouts/Base.astro`, which loads the host
  PostHog tracker and sets `data-page-key`. `public/posthog.js` must keep the
  managed snippet shape verified by `scripts/checks/check-analytics-sites.ts`.
- Third-party scripts are opt-in per item, gated on hostname and the item's
  path prefix, and must be allowed by `landingPagesCsp` in
  `packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts`.
- Fonts and images are same-origin build output; the CSP has no font or image
  CDNs.
- Server addresses and links on The Storm page must match
  `packages/storm-forum/config/forum.json` and the docs join page.

```bash
bun run build
bun run typecheck
bun run lint
```

Render changed items at phone and desktop widths before review.
