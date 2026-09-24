# macos-cross-site

Astro + Tailwind marketing site for the
[macos-cross-compiler](../macos-cross-compiler/) Docker image, served at
<https://macos-cross.sjer.red>.

## Commands

Run from `packages/macos-cross-site`:

```bash
bun run dev       # astro dev
bun run build     # astro build → dist/
bun run preview   # astro preview
bun run deploy    # bun ../../scripts/release/deploy-site.ts macos-cross
```

`bun run lint` and `bun run typecheck` run `astro check` (typecheck adds
`tsc --noEmit`).
