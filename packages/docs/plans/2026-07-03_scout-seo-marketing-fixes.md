# Scout Marketing Site — SEO + Usability Fixes

## Status

Complete (implemented on `feature/scout-seo`)

## Context

An SEO + mobile/desktop usability sweep of **https://scout-for-lol.com/**
(`packages/scout-for-lol/packages/frontend/`, Astro 6 + React islands + Tailwind v4)
found that all metadata gaps stemmed from one root cause: `src/layouts/Layout.astro`
hardcoded a single `<title>`, took no props, and emitted no description / canonical /
Open Graph / Twitter / JSON-LD, and `astro.config.mjs` set no `site`. All 6 indexable
pages shipped byte-identical `<head>` metadata; there was no sitemap; the referenced
`/favicon.svg` 404'd; robots.txt had no `Sitemap:` line; and social shares rendered blank.
Usability was otherwise strong — no horizontal overflow, no tiny fonts, working mobile
drawer — the only gap was a handful of sub-44px tap targets.

## What was implemented

- **Shared `src/components/SeoHead.astro`** (meta-only, no visual tokens) used by all
  three layouts (marketing `Layout`, app `AppLayout`, review-tool layout). Emits unique
  title/description, canonical (trailing-slash form, matching the Caddy 301), full
  Open Graph + Twitter, favicon set, `viewport` with `initial-scale=1`, and a
  `SoftwareApplication` JSON-LD block (skipped on noindex pages). Every page emits the
  `og:*` tags the OG extractor requires.
- **Per-page title/description** passed from the 6 marketing pages + `ContentLayout`
  (legal MDX). `app/**` and `dev/*` carry `noindex`.
- **`astro.config.mjs`**: `site: "https://scout-for-lol.com"`, `@astrojs/sitemap`
  (filtering `/app/` + `/dev/`), and the in-repo **`astro-opengraph-images`** integration
  rendering a **branded per-page OG image** (`src/lib/og-template.tsx` — indigo→violet
  gradient, gradient-S badge, Beaufort title, Spiegel description) using the site's fonts.
- **Favicon set** generated from a new `public/favicon.svg` (gradient-S, matches Navbar)
  via `scripts/generate-favicons.ts`: `favicon-48x48.png`, `apple-touch-icon.png`,
  multi-size `favicon.ico`, plus `site.webmanifest`.
- **`public/robots.txt`** with `Allow: /`, `Disallow: /app/ /dev/`, and the `Sitemap:` line.
- **Tap targets ≥44px**: nav links (`h-11`), desktop + mobile CTAs, mobile drawer items,
  footer links (both variants), and standalone arrow CTAs — via targeted `min-h-[44px]`
  (no global button-token change). One mid-prose inline link left as-is (WCAG-exempt).

## Load-bearing risk (resolved)

Scout aliases `satori`/`@resvg/resvg-js` to browser stubs; the OG integration needs the
real ones at `astro:build:done`. Validated in Phase 0: a local build produced real
1200×630 PNGs — the vite alias does not leak into the build hook, so no alias scoping was
needed. The `astro-opengraph-images` barrel import was kept out of page SSR chunks by
computing the OG image path inline in `SeoHead` (importing the barrel pulled the whole
Satori/jsdom integration — and a transitive `../data/patch.json` — into every page).

## Verification (done locally)

- `bun run build` (with placeholder `PUBLIC_PINTEREST_TAG_ID`/`PUBLIC_REDDIT_PIXEL_ID`),
  `bun run typecheck`, `bunx eslint src` — all green.
- `dist/` inspection: distinct title/description/canonical/OG/Twitter/JSON-LD per page;
  16 branded OG PNGs; `sitemap-index.xml` excludes `/app/` + `/dev/`; favicon set +
  `robots.txt` at root; `app/**` + `dev/*` carry `noindex`.
- Low-stealth Chrome (CDP) at 1440/375: no visual regression, favicon loads, mobile
  hamburger opens, zero sub-44px header/footer tap targets (one intentional prose link).

## Post-merge verification (cannot run on dryrun PR branch)

- Confirm Cloudflare serves our origin `robots.txt` (it currently serves a CF-managed
  content-signals file because the origin had none) — may need the CF managed-robots toggle.
- Confirm live `sitemap-index.xml` resolves and a shared link shows the OG card in Discord.

## Out of scope (hosting/DNS layer)

- Soft-404 (`301 → 403` for missing paths) — would need a `404.astro` + Caddy `notFoundPage`.
- `www.scout-for-lol.com` not resolving — DNS.

## Session Log — 2026-07-03

### Done

- All phases implemented on `feature/scout-seo` (see file list in the PR): `SeoHead.astro`,
  `og-template.tsx`, `astro.config.mjs`, favicon set + `robots.txt` + `site.webmanifest`,
  `scripts/generate-favicons.ts`, per-page title/description, tap-target bumps.
- Build/typecheck/lint green; OG generation + head tags + sitemap verified in `dist` and
  in a low-stealth browser.

### Remaining

- Open PR + attach a branded OG sample. Post-merge: CF robots.txt + live sitemap/OG-card checks.

### Caveats

- Legal-page descriptions were added to `privacy.mdx` / `tos.mdx` frontmatter.
- Local builds need placeholder `PUBLIC_PINTEREST_TAG_ID` / `PUBLIC_REDDIT_PIXEL_ID` env vars.
- Any future JS-interaction testing on this site must use a **low/no-stealth** browser
  (full-stealth injects a CSP that blocks island hydration — see the sweep log).
