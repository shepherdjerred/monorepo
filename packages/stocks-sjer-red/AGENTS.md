# Stocks site constraints

This Astro site is an intentionally playful hardware "portfolio." `README.md`
owns the data format and provenance.

- `src/data/components.json` is the hand-maintained source of truth. Append
  dated price observations; the final entry is the current mark.
- Validate data through `src/data/schema.ts`; do not add defaults for malformed
  history.
- Derived totals, changes, and chart series belong in `src/data/load.ts`, not
  duplicated in pages.
- Historical values extracted from charts are approximate. Preserve the
  provenance note and never present the site as financial advice.

```bash
bun run build
bun run typecheck
bun run lint
```

Capture the rendered index and an affected detail page when data or chart
presentation changes.
