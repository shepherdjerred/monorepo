---
id: scout-unified-design-system-2026-08-15
type: plan
status: planned
board: false
---

# Scout Unified Design System and Surface Migration

## Goal

Create `@scout-for-lol/design-system` as the shared visual foundation for
Scout's generated reports, Astro marketing site, Starlight documentation site,
and Vite management app. The web surfaces gain independent Classic/Modern and
Light/Dark axes, shared chrome and a complete component catalog. Reports adopt
the shared foundations without changing any SVG or PNG byte.

## Confirmed Product Decisions

- New visitors use the Modern skin and system appearance. Theme state is
  browser-local and shared across `/`, `/docs/`, and `/app/`.
- All three sites render one global navbar and footer. The app adds account
  actions and keeps its permission-aware guild subnavigation.
- Classic and Modern are full visual skins: typography, ornament, borders,
  radii, shadows, and motion may differ while semantics and layout slots stay
  stable.
- The design system owns reusable primitives, compositions, chrome, and
  Scout-domain widgets. Backend-aware workflows remain with their app.
- The existing committed Riot asset corpus is self-hosted once under a
  versioned, same-origin path. `@scout-for-lol/data` remains the canonical
  source of the bytes.
- The component workbench remains local/CI-only. No design-system catalog or
  appearance guide is published in Starlight.
- Deliver the complete migration in one feature PR and one production
  promotion, with coherent internal commits and beta acceptance before prod.

## Theme and Asset Contracts

- Persist `{ version: 1, skin, mode }` under `scout-theme-v1`, where `skin` is
  `classic | modern` and `mode` is `system | light | dark`.
- Apply `data-scout-skin` and `data-scout-mode` before first paint. Derive the
  temporary Tailwind `.dark` class and Starlight `data-theme` from that single
  runtime.
- Migrate the app's `scout-app-theme` preference before the marketing site's
  `theme` preference when canonical state is absent. Legacy users enter the
  Modern skin.
- Store canonical tokens in JSON validated by JSON Schema and Zod. Generate
  typed objects and standalone CSS, with explicit state colors for all four
  resolved themes and WCAG AA contrast checks.
- Modern typography is Beaufort/Spiegel; Classic typography is
  QTFrizQuad/Gill Sans. Preserve the current Noto Sans CJK fallback ordering in
  every Satori entrypoint.
- Consolidate exact fonts, licenses, rank crests, and a new original
  compass/ward-eye Scout emblem under the design-system package.
- Generate a browser-safe asset manifest with corpus version, kind, canonical
  key, MIME type, dimensions, path, and SHA-256. Publish game assets at
  `/assets/scout/game/<version>/`, with separate shared rank, brand, and font
  prefixes. Browser consumers never fetch Riot/CDDragon at runtime.

## Component Catalog

The closed catalog covers foundations; form, navigation, overlay, data-display,
feedback and layout primitives; global chrome and page shells; existing
marketing compositions; and Scout-domain widgets for champions, ranks, lanes,
items, runes, spells, augments, Discord identities, statuses, charts, report
tables, Markdown, loading/error states, and form-dialog framing.

Every existing app, marketing, docs, and review-tool component is classified as
one of: moved into the design system, rebuilt locally from catalog components,
or retained as framework/business infrastructure. Duplicate local primitive
directories and independent theme systems are removed. The desktop-only
`@scout-for-lol/ui` sound editor remains out of scope.

### Path-complete migration inventory

The first matching row classifies every component-bearing path in scope.

| Existing scope                                                                                                                                                                                                     | Classification                       | Migration                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/src/components/ui/**`, `frontend/src/components/ui/**`, `frontend/src/components/review-tool/ui/**`                                                                                                           | 1. Move                              | Replaced by the corresponding catalog primitives; duplicate directories removed.                                                                                |
| Former app/frontend navbars, mobile navigation, footers, theme providers, and bootstrap scripts                                                                                                                    | 1. Move                              | Replaced by shared chrome and the one theme runtime/bootstrap.                                                                                                  |
| Report palettes, shared typography/loaders, rank crests, and shared visual constants                                                                                                                               | 1. Move                              | Owned by Satori-safe design-system exports; report compatibility exports remain.                                                                                |
| Champion/rank/art/icon rendering and reusable status, chart, Markdown, report-table, loading/error, and form-dialog framing                                                                                        | 1. Move                              | Implemented as value/callback-only domain widgets and typed asset resolvers.                                                                                    |
| `app/src/components/**` not matched above and all `app/src/routes/**`                                                                                                                                              | 2. Rebuild locally                   | Permission-aware forms, dialogs, tables, onboarding, Explore, report management, and route composition now consume the catalog.                                 |
| `frontend/src/components/*.astro` except shared-chrome wrappers, `frontend/src/components/report-ui/**`, `frontend/src/components/review-tool/**` not matched above, and `frontend/src/data/changelog-builder.tsx` | 2. Rebuild locally                   | Marketing/report-review business compositions consume shared tokens, primitives, domain widgets, or marketing compositions while preserving content and events. |
| `frontend/src/components/{Navbar,Footer}.astro`, `docs-site/src/components/overrides/**`, and `docs-site/src/components/shared-docs-navbar.tsx`                                                                    | 3. Framework adapter                 | Thin Astro/Starlight adapters render shared chrome while preserving Starlight search, sidebar, PageFrame, Pagefind, and base paths.                             |
| App router/main, auth, permission, tRPC, analytics, and route-loader modules                                                                                                                                       | 3. Framework/business infrastructure | Remain local and retain their existing contracts and privacy gates.                                                                                             |
| Frontend pages/layouts, SEO/OpenGraph, analytics bootstrap, content collections, and Astro routing                                                                                                                 | 3. Framework infrastructure          | Remain local; visual output consumes shared tokens/components and report showcases stay unchanged.                                                              |
| Starlight config, content, search/Pagefind, sidebar, routing, and generated integration files                                                                                                                      | 3. Framework infrastructure          | Remain Starlight-owned with targeted supported overrides only.                                                                                                  |

## Implementation Order

1. Establish a committed report visual contract before moving any report code.
   Regenerate deterministic fixtures and record exact SVG/PNG hashes,
   dimensions, renderer/fixture identities, font ordering, and asset hashes.
2. Build the design-system package, generated tokens/CSS, browser runtime,
   fonts, brand, asset manifest/build integration, components, domain widgets,
   and local Vite workbench.
3. Move report palettes, typography, fonts, rank assets, and shared constants
   behind Satori-safe design-system exports. Preserve report APIs, markup,
   layout, routing, chart themes, feature flags, and exact output bytes.
4. Migrate Starlight through targeted header/footer/theme overrides, migrate
   marketing without changing copy/SEO/analytics/report showcases, and migrate
   the app without changing routes, auth, permissions, tRPC contracts, or
   analytics privacy.
5. Update Scout instructions and architecture docs that currently require
   distinct visual systems, run focused and merged-bucket verification, attach
   visual evidence, and submit one git-spice feature PR.

## Verification

- Validate token schema/generated drift, all four resolved themes, contrast,
  preference migration, storage failure, system changes, cross-tab updates,
  keyboard/focus behavior, and asset manifest/file integrity.
- Build and visually test the local workbench at desktop/mobile widths in all
  four themes, including reduced motion and accessibility scans.
- Require exact report SVG bytes, PNG bytes, dimensions, fonts, and assets for
  legacy/ranked/Arena/Classic post-match, standard/Arena/Classic pre-match,
  analytics/competition/visualization charts, and Discord screenshots. Baseline
  updates are forbidden during this migration.
- Run focused build, typecheck, test, and lint tasks for design-system, data,
  report, app, frontend, and docs, then the merged site build and Buildkite.
- Verify beta's exact release, all three entrypoints and deep links, cross-path
  theme persistence, docs search/sidebar, authenticated app flows, same-origin
  asset/font hashes, CSP, and representative pre/post-match generation before
  promoting production.

## Boundaries

- Reports gain no new appearance option and may not change visually or
  bytewise.
- No account-synchronized theme preference.
- No backend/API/schema additions solely for decorative art.
- No desktop or sound-editor migration.
- No deployment-topology change; the three builds still merge into one bucket.
- League inspiration uses approved game assets and Scout's established report
  language without copying Riot/client trademarks or product structure.
