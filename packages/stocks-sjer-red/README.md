# stocks-sjer-red

Astro static site at [stocks.sjer.red](https://stocks.sjer.red) presenting a
personal PC-hardware "stock portfolio" — a Bloomberg-style ironic take on the
2025–2026 DRAM/NAND price spike. Each component (RAM, SSD, GPU, …) gets a
ticker row with cost basis, current mark, and P&L, plus a per-component detail
page with an SVG price chart and full price-history table.

Data lives in `src/data/components.json`, validated at build time by the Zod
schema in `src/data/schema.ts` — bad JSON fails `astro build`. Derived numbers
(line totals, portfolio totals, percent change) are computed in
`src/data/load.ts`. Charts are zero-dependency SVG components
(`StockChart.astro`, `Sparkline.astro`); styling is Tailwind CSS 4.

## Commands

```bash
bun run dev        # dev server on localhost:4321
bun run build      # astro check + tsc --noEmit + astro build
bun run preview    # preview the production build
bun run typecheck  # tsc --noEmit
bun run deploy     # bun ../../scripts/release/deploy-site.ts stocks-sjer-red
```

See [AGENTS.md](AGENTS.md) for how to update prices, data provenance, and
contributor/agent workflow notes.
