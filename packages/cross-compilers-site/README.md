# cross-compilers-site

Astro + Tailwind marketing site for the
[macos-cross-compiler](../macos-cross-compiler/) and
[windows-cross-compiler](../windows-cross-compiler/) Docker images, served at
<https://cross-compilers.sjer.red>.

## Commands

Run from `packages/cross-compilers-site`:

```bash
bun run dev       # astro dev
bun run build     # astro build → dist/
bun run preview   # astro preview
bun run deploy    # bun ../../scripts/release/deploy-site.ts cross-compilers
```

`bun run lint` and `bun run typecheck` run `astro check` (typecheck adds
`tsc --noEmit`).
