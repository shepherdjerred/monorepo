# Desktop icons

These files are generated. Do not edit them by hand or run `bunx tauri icon`
directly — that bypasses Scout's shared brand kit.

Regenerate from the compass mark and theme tokens:

```bash
bun run generate:brand
```

That command lives in `@scout-for-lol/design-system` and writes this directory
plus the marketing/Discord/favicon rasters. `bun run check:generated` in the
design-system package fails if these icons drift.
