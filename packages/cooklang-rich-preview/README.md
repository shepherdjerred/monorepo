# cooklang-rich-preview

Astro + Tailwind marketing site for the
[Cooklang Rich Preview Obsidian plugin](../cooklang-for-obsidian/), deployed to
<https://cook.sjer.red>.

## Commands

Run from `packages/cooklang-rich-preview`:

```bash
bun run dev       # astro dev
bun run build     # astro build → dist/
bun run preview   # astro preview
bun run deploy    # bun ../../scripts/release/deploy-site.ts cook — syncs dist/ to the SeaweedFS "cook" bucket
```

`bun run lint` and `bun run typecheck` run `astro check` (typecheck adds
`tsc --noEmit`).
