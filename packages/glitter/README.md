# glitter

Static single-page site at [ppl.glitter-boys.com](https://ppl.glitter-boys.com)
that renders an interactive force-directed graph (D3 v7) of the Glitter Boys
friend group: people as nodes, relationships as labeled edges. The page has
controls for charge/link-distance sliders and label toggling; bidirectional
relationships are styled distinctly.

## Data source

All graph data comes from the workspace package
[`@shepherdjerred/glitter-context`](../glitter-context/): the build imports its
`people` and `currentRelationships` exports and inlines them as a frozen
`globalThis.GLITTER_CONTEXT` object in `dist/context-data.js`. People without a
current relationship are included as isolated nodes. There is no runtime data
fetching — the site is fully static.

## Structure

- `public/index.html` — the entire app: styles, controls, and the D3 rendering
  script (D3 is loaded from the d3js.org CDN)
- `scripts/build.ts` — copies `index.html` to `dist/` and generates
  `dist/context-data.js` from glitter-context
- `test/build.test.ts` — asserts the current-relationship semantics of the
  underlying data (history collapses to one current edge per pair)

## Commands

```bash
bun run build    # build dist/ (requires glitter-context's dist; see below)
bun run test     # bun run test test
bun run deploy   # bun ../../scripts/release/deploy-site.ts glitter
```

`build` imports `@shepherdjerred/glitter-context`, whose `dist/` is gitignored
and not produced by `bun install` — on a clean checkout run
`bun run --cwd ../glitter-context build` first. The `deploy` script does this
automatically, then syncs `dist/` to the `glitter-boys-ppl` S3 bucket serving
ppl.glitter-boys.com.
