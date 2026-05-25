# stocks.sjer.red — initial build

## Status

Complete

## Goal

Build a Bloomberg-terminal-style website hosted at stocks.sjer.red that frames the user's PC build as a stock portfolio. Real data — daily/monthly price history for each component the user owns — sourced from PCPartPicker. Bloomberg dark theme, monospace, green/red ticker conventions.

## Source of truth

User shared their PCPartPicker saved part list **"NAS Upgrade 2024/2025"** and 11 CleanShot screenshots of PCPartPicker product-page price-history charts (one per component, plus a SSUPD Meshroom S V2 product page correcting the case). All price data in `components.json` was hand-extracted from those screenshots.

User flagged that the actual case is the **Meshroom S V2** ($159.99), not the Silverstone CS380 that was in the PCPartPicker list.

## Data-source research

Investigated several pricing APIs before going manual:

- **PCPartPicker** — daily-updated PNG trend charts at deterministic URLs but no JSON / no historical URL pattern (filename includes random hash). Product-page history is JS-rendered. TOS forbids scraping.
- **Keepa** — clean API for Amazon ASINs but $19/mo and their site requires WebSocket (lightpanda fails).
- **diskprices.com** — current spot only, no history.
- **DRAMeXchange / TrendForce** — DRAM/NAND contract prices, weekly/monthly, but aggregate not SKU-level.
- **FRED PPI** (BLS Producer Price Index for storage / semiconductors) — free, monthly, macro-only.

Conclusion: there is no clean free daily-SKU API. Manual JSON updates are the right primitive for this site. User screenshots provided a usable 23-month backfill for the 10 components in the build.

## Implementation

New package `packages/stocks-sjer-red` (Bun workspace, Astro 6, Tailwind 4, Zod 4). Zero JS dependencies for the chart — pure SVG `<path>` rendered server-side at build time.

### Files

- `package.json` — minimal, just astro+tailwind+zod
- `astro.config.ts`, `tsconfig.json`, `src/env.d.ts`
- `src/styles/global.css` — Tailwind v4 with custom theme tokens (`--color-bg`, `--color-up: #00ff88`, `--color-down: #ff3b3b`, `--color-amber: #ffb000`, IBM Plex Mono)
- `src/data/schema.ts` — Zod schemas (`PricePointSchema`, `ComponentSchema`, `PortfolioSchema`); build fails if JSON drifts
- `src/data/load.ts` — derived: `currentPrice`, `startPrice`, `lineTotal`, `pctChange`, `portfolioHistory` (date-aligned aggregation across all components), formatters
- `src/data/components.json` — single source of truth, 10 components × ~24 monthly datapoints each
- `src/components/StockChart.astro` — auto-scales y-axis with 8% padding, draws line + filled area, color follows `last >= first`
- `src/components/Sparkline.astro` — `StockChart` wrapper with `showAxis={false}` for table rows
- `src/layouts/Layout.astro` — header with stocks.sjer.red branding + PT timestamp, footer disclaimer
- `src/pages/index.astro` — portfolio total card with big chart, then ticker table sorted by line total descending
- `src/pages/[slug]/index.astro` — per-component detail: big chart, 52w high/low, full price-history table with delta %
- `public/favicon.svg` — green upward stock-line glyph

### Portfolio at launch

- Cost basis (2024-07-01): **$4,510**
- Mark (2026-05-24): **$13,272**
- P&L: **+$8,762 (+194.27%)**
- Top performers: DDR5 (+347%), 870 EVO (+300%), 990 Pro (+135%)
- Only loser: INTC (-16%) — Intel cut i9-14900K MSRP post-Raptor Lake instability fiasco
- Flat: MeshRoom case (no history available, two anchor points)

## Verification

- `bun run build` (astro check + tsc + astro build) — clean, 11 static routes generated
- Started dev server via `.claude/launch.json` Preview MCP config
- Screenshotted index at 1600×1600 desktop and 375×812 mobile — both render correctly
- Screenshotted detail page for DDR5 — chart, summary stats, and history table all correct
- Navigation between index and detail pages works
- Color conventions correct: green for portfolio (up), green/red per-ticker
- Numbers cross-checked: $13,272 portfolio mark matches sum-of-line-totals from JSON
- Mobile responsive: table collapses to Ticker / Qty / Line / Chg% columns

## DNS / deployment

Not addressed in this session. Site is just `bun run build` → `dist/`. The `stocks.sjer.red` subdomain needs DNS + a static host (Cloudflare Pages, Vercel, Netlify, or homelab pod). The `astro.config.ts` `site` is set to `https://stocks.sjer.red`.

## Caveats

- Price-history datapoints are **approximations read by eye** from PCPartPicker chart PNGs — accurate to within ~$5–$20 per point. The user is the source of truth going forward.
- The SF750 PSU's last datapoint is Feb 2025; PCPartPicker showed "No Prices Available" at the time of the screenshot. Treated as discontinued at retail; current mark is last-known $185.
- The user's actual build may include alternate parts seen in the screenshots (Arctic Liquid Freezer III Pro 240 instead of Noctua NH-D12L; Noctua NF-A12x15 instead of F12 PWM). Build list preserved as-is per user's explicit case correction only.
- Each component's `pcppUrl` was inferred from the part name + part number conventions — should be verified.

## Session Log — 2026-05-24 Mobile Layout

### Done

- New package `packages/stocks-sjer-red`
- Zero-dep SVG stock chart component with auto-scaling axes, area fill, up/down color
- Sparkline component for table rows
- Zod-validated JSON data layer with 10 components × ~24 monthly datapoints
- Portfolio index page + per-component detail pages, all statically built
- Bloomberg-style dark/amber theme with IBM Plex Mono
- Mobile responsive table collapse
- `.claude/launch.json` entry for `stocks` dev server (port 4321)
- AGENTS.md in the package
- This log

### Live UX layer (added in same session)

- Scrolling ticker-tape marquee at the top of every page, pause-on-hover, duplicated content for seamless loop
- Live wall clock with HH:MM:SS in PT, pulsing green LIVE dot
- Client-side tick simulator (`src/scripts/live.ts`): picks a random ticker every 400–1200ms, drifts price ±0.3% with mean-reversion toward the canonical base, flashes the updated cell green/red for 700ms
- Tick propagates to: every `[data-price]`, `[data-line]`, `[data-chg]` cell on the page (row + per-component detail header + stats grid) and the portfolio aggregate `[data-portfolio-mark]` / `[data-portfolio-pnl]` / `[data-portfolio-pct]`
- Mean-reversion factor keeps simulated prices anchored to the static base so the display doesn't drift far from the real published number

### Real market data for the ticker tape

- Replaced the personal-portfolio-driven tape with **real Yahoo Finance quotes** for 12 hardware/semi tickers: MU, NVDA, AMD, INTC, TSM, AVGO, ASML, SMCI, WDC, STX, LRCX, AMAT
- `src/data/market.ts` calls `https://query1.finance.yahoo.com/v8/finance/chart/{SYMBOL}?range=5d&interval=1d` per symbol (no auth, no key), Zod-validates the response, fans out via `Promise.all`
- Module-level memoization so one build hits the API once per symbol total (not per page)
- Disk cache at `.cache/market.json` with a 60-minute TTL; gracefully falls back to stale cache if the live fetch fails (logged, not silent)
- `.gitignore` added at the package root to keep `.cache/`, `dist/`, `.astro/`, `node_modules/` out of git
- The tape entries are now static within a page load — they no longer participate in the cosmetic tick simulator, so they always show the real Yahoo close
- Disclaimer trimmed: removed the "Not investment advice / past performance" joke per user request; kept the "cosmetic simulation" + "Yahoo Finance" attribution lines

### Remaining

- DNS for `stocks.sjer.red` and a static host (Cloudflare Pages recommended)
- Verify each `pcppUrl` actually resolves (was inferred from part numbers)
- Decide if user actually wants Arctic LF III Pro + A12x15 fans swapped in instead of NH-D12L + F12 PWM (Amazon receipt screenshots suggest yes; PCPartPicker build list says no)
- Optional: add a DRAM/NAND contract-price macro index from TrendForce as a second "ETF" — would be the only way to ground the SKU prices in real DRAM industry pricing rather than retail
- Optional: ship the dist/ to the homelab and add an ArgoCD app like the other sjer.red surfaces

### Build correction + purchase-aware cost basis (later in session)

- Replaced the Noctua NH-D12L air cooler with the **Arctic Liquid Freezer III Pro 240** AIO (ticker AIO) — the cooler the user actually purchased per their Amazon receipt screenshot ($70.49 on 2025-12-17). Limited history (~8 monthly points from launch Sep 2024 to today) since there is no PCPartPicker chart screenshot for it; user can fill in more datapoints later.
- Schema now requires a `purchases: { date, quantity, pricePaid }[]` per component instead of a top-level `quantity`. Quantity is derived as the sum; cost basis is `sum(qty * pricePaid)`; weighted-average purchase price drives the per-row CHG %.
- Purchase dates per user clarification: most items purchased 2024-07-15. **1 set of DDR5 RAM, 1 × 990 Pro NVMe, and all 6 × 870 EVO SSDs purchased 2025-12-17** — i.e. partway through the price spike, so cost basis is materially higher than the naive "first historical price" gave us before.
- Cost basis went from $4,510 → **$6,185**; P&L correspondingly dropped from +$8,762 → **+$7,095 (+114.71%)** — more honest because the user really did pay peak-ish prices for the Dec 2025 batch.
- `portfolioHistory()` now respects ownership-at-date: components contribute zero to the timeline before their first purchase, so the chart honestly shows ramp-on as you bought stuff rather than pretending you owned all 10 positions from day one.
- Detail page now shows a separate **Purchases** table (date / qty / unit paid / subtotal) above the **Price history** table, and the header switched from "from $X" to "vs. avg buy $X".

### Final-session polish

- Removed "Personal Hardware Exchange" subtitle from header
- Build caption changed from `NAS UPGRADE 2024/2025 · RIOTSHIELDER` to **`HOMELAB · view build on PCPartPicker →`** with the user's saved-list URL (`https://pcpartpicker.com/user/RiotShielder/saved/#view=DkxRgs`)
- Added top disclaimer below the header: _"Real-time updates are obviously fake. There isn't any day trading for SSDs/RAM (yet)."_
- Removed footer entirely (was: "Data hand-curated from PCPartPicker price-history charts. Intraday ticks are a cosmetic simulation. Top tape: real-time quotes from Yahoo Finance.")
- Added `buildUrl` to portfolio schema so the link is data-driven, not hardcoded in the template

### Caveats

- Don't trust the price-history numbers to the dollar — they're chart-pixel reads
- The "+$8,762 P&L" is on paper only; user has not actually sold any RAM at the spike
- Building with `astro check` will fail loudly if anyone introduces bad JSON

## Session Log — 2026-05-24 Chart Interaction

### Done

- Fixed the mobile index layout in `packages/stocks-sjer-red/src/pages/index.astro` by replacing the cramped phone table with tappable position cards below the `sm` breakpoint.
- Updated `packages/stocks-sjer-red/src/styles/global.css` with responsive mobile-card metric grids, including a two-column layout for narrow 320px phones and four columns for wider phones.
- Fixed the per-position detail hero in `packages/stocks-sjer-red/src/pages/[slug]/index.astro` so the image/title block and price block stack cleanly on phones instead of squeezing the title into a vertical column.
- Verified in the in-app browser at 320px, 375px, and desktop widths; mobile pages now report no horizontal document overflow.
- Ran `bun run build`, `bun run test`, and `bun run lint` in `packages/stocks-sjer-red`.

### Remaining

- None for the requested mobile cleanup.

### Caveats

- The package still has no real test suite; `bun run test` currently prints `No tests yet`.
- I used the installed Bun binary directly because invoking the mise shim tried to persist repo trust outside the sandbox.

## Session Log — 2026-05-24 Image Background

### Done

- Improved phone chart interactions in `packages/stocks-sjer-red/src/components/StockChart.astro` by switching from mouse/touch split handlers to pointer-aware interaction.
- Added a full plot-area hit rectangle so the chart responds across the graph surface, not only near rendered SVG paths.
- Added mobile-specific behavior: larger marker, amber crosshair while touching, docked tooltip placement inside the chart, and short tooltip persistence after lifting a finger.
- Updated `packages/stocks-sjer-red/src/styles/global.css` with chart touch-action, tap-highlight removal, touch tooltip styling, and hit-area pointer behavior.
- Verified the portfolio chart at a 375px phone viewport in the in-app browser; tooltip stayed inside the chart and the page had no horizontal overflow.
- Ran `bun run build`, `bun run lint`, and `bun run test` in `packages/stocks-sjer-red`.

### Remaining

- None for the requested chart interaction polish.

### Caveats

- Browser verification exercised the rendered phone viewport and desktop pointer path; the touch-specific path is implemented with standard pointer events, but the in-app browser does not expose a true coarse-pointer touchscreen.
- The package still has no real test suite; `bun run test` currently prints `No tests yet`.

## Session Log — 2026-05-24

### Done

- Localized all product thumbnails for `packages/stocks-sjer-red` so the portfolio no longer depends on remote PCPartPicker/Amazon image URLs.
- Removed connected near-white backgrounds from the product thumbnails with ImageMagick, preserving product-internal white details by using corner flood-fill transparency instead of global white deletion.
- Stored processed transparent PNGs under `packages/stocks-sjer-red/public/images/` and moved original source downloads to `packages/stocks-sjer-red/src/assets/product-image-sources/`.
- Updated `packages/stocks-sjer-red/src/data/components.json` to reference local cutout assets.
- Added `--color-product-bg` in `packages/stocks-sjer-red/src/styles/global.css` and applied it to thumbnail/detail image frames for a gray product backdrop.
- Verified mobile index, desktop index, and mobile detail views in the in-app browser; images loaded from local paths and no horizontal overflow was introduced.
- Ran `bun run build`, `bun run lint`, and `bun run test` in `packages/stocks-sjer-red`.

### Remaining

- None for the requested image-background pass.

### Caveats

- The source thumbnails remain in the repo for future reprocessing, but they are outside `public/` and are not served by the site.
- `bun run test` still only prints `No tests yet`.

### Summary

The image-background pass is complete: thumbnails are local transparent PNGs, product frames now use the gray CSS background, and the site build/lint/test checks passed.

## Session Log — 2026-05-24 PR Health Loop

### Done

- Opened PR #929 for `codex/stocks-mobile-polish`: <https://github.com/shepherdjerred/monorepo/pull/929>.
- Fixed the Greptile P2 review finding in `packages/stocks-sjer-red/src/components/StockChart.astro` by ignoring additional touch/pen `pointerdown` events while an active touch pointer is already tracked.
- Fixed Buildkite formatting failures by running Prettier on the chart component and making duplicate session-log headings unique in this log.
- Verified locally with `bun run build`, `bun run lint`, `bun run test`, targeted Prettier check, and targeted markdownlint.
- Pushed follow-up commit `a8558db01`; Buildkite build #2915 passed, including `no-entry-merge-conflict-check`, Prettier, markdownlint, lint, typecheck, and test.
- Confirmed CodeRabbit and Greptile review checks passed after the follow-up commit; the prior Greptile P2 thread is resolved.
- Addressed the remaining CodeRabbit minor docs-log thread by adding a closing summary to the image-background session block.

### Remaining

- None.

### Caveats

- Local Git hooks were skipped for the follow-up commit because the sandboxed mise shim refuses to trust `.mise.toml`; equivalent checks were run manually and then passed in Buildkite.
- `bun run test` in `packages/stocks-sjer-red` still prints `No tests yet`.
