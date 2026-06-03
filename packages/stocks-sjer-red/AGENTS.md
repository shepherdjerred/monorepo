# stocks-sjer-red

Personal hardware "stock portfolio" — Bloomberg-style ironic take on the 2025–2026 DRAM / NAND price spike.

## What's here

- `src/data/components.json` — single source of truth. Edit by hand.
- `src/data/schema.ts` — Zod schema enforced at build time. Bad JSON fails `astro build`.
- `src/data/load.ts` — derived computations: line totals, portfolio totals, % change, history aggregation.
- `src/components/StockChart.astro` — zero-dep SVG line chart, auto-colored green (up) / red (down).
- `src/components/Sparkline.astro` — `StockChart` with `showAxis=false` and a fixed small viewport.
- `src/pages/index.astro` — portfolio summary + ticker table.
- `src/pages/[slug]/index.astro` — per-component detail page with full price-history table.

## Updating prices

Append a new entry to the relevant component's `history` array in `components.json`:

```jsonc
{ "date": "2026-06-15", "price": 999.99 }
```

The last entry is treated as the current mark. Dates must be `YYYY-MM-DD`. Build fails if the schema is violated.

For SKUs without a PCPartPicker URL, prices were taken from the manufacturer page (e.g. SSUPD direct for Meshroom S V2).

## Data provenance

Monthly history (Jul 2024 → May 2026) was extracted by eye from PCPartPicker price-history charts on 2026-05-24. Numbers are approximate — within ~$5 for cheap parts and ~$20 for the high-volatility RAM/SSD lines. Going forward, manually append precise points as needed.

The "Cost Basis" / "P&L" framing is a joke. These are sunk costs, not investments. Do not actually use this to make life decisions.

## Commands

```bash
bun run dev        # localhost:4321
bun run build      # astro check + tsc + astro build
bun run typecheck  # tsc --noEmit
```
