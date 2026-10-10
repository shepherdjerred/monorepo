# Glitter Boys

Astro homepage and Starlight game guides for `glitter-boys.com`.

The homepage contains the Glitter Boys title and decorative CSS twinkles. The guides live at `/docs/`; the homepage has no docs link.
The docs are public and use normal Starlight search and sitemap behavior.

## Develop

From the repository root:

```sh
bun run --cwd packages/glitter-boys dev
bunx turbo run build typecheck test lint --filter=@shepherdjerred/glitter-boys
bun run --cwd packages/glitter-boys preview
```

Guide content lives in `src/content/docs/docs/`. The crossplay section at
`/docs/crossplay/` has separate Windows and Apple silicon macOS setup pages,
a shared joining how-to, and a compatibility reference. The existing per-game
walkthroughs cover Windows amd64; platform instructions stay on their own pages.
The Windows entry point is `/docs/launcher/`, with original captures of the
Rust/egui preview in the sibling `glitter-boys-launcher` package. Manual Windows
walkthroughs appear under Advanced. Keep release availability and signing claims
aligned with published artifacts; the current guide describes a private preview.
The custom homepage is an Astro page; Starlight supplies the
404 page. The homepage and docs share a pastel palette and the self-hosted
Luckiest Guy display font. Its Apache 2.0 license is included beside the font
in `src/assets/fonts/LICENSE.txt`. Animation respects reduced-motion preferences.

The guides target Apple silicon macOS and Windows amd64 crossplay: MW2 MP,
and Black Ops I/II/III MP and Zombies. The compatibility reference distinguishes
upstream documentation from community reports and locally verified sessions.
The Windows MW2, BO2, and BO3 walkthroughs use the group ZIP archives. BO3's
ZIP walkthrough uses BOIII. Its separate crossplay walkthrough at
`/docs/crossplay/windows/bo3/` uses Steam with T7Patch on Windows and BO3MacFix on Mac; BOIII compatibility
with that route is unverified. Plutonium on Apple silicon remains experimental.
Client guides link to IW4x, Plutonium, BOIII, T7Patch, and BO3MacFix upstream documentation.
Check download URLs and upstream setup steps before updating a guide. Archive
size estimates describe the existing group downloads, not a Steam installation.

Each game walkthrough is MDX and includes prerequisites, numbered setup steps,
checkpoints, group joining, and troubleshooting. `Screenshot.astro` produces
responsive images with captions, source credits, and links to the full-size
asset. First-party captures can use a plain source credit; upstream images keep
their source links. Screenshot sources and the IW4x media license are documented in
`src/assets/guides/README.md`. Keep screenshot examples distinct from a local
game acceptance test, and label older UI layouts in their captions.

## Hosting

Woodpecker builds this package and publishes `dist/` to the `glitter-boys`
SeaweedFS bucket. The existing homelab static-site service serves it through
Cloudflare Tunnel and Caddy. DNS and bucket lifecycle are owned by OpenTofu;
the host binding and HTTP probes are owned by CDK8s.

The root and `/docs/` have HTTP probes. The deployment catalog preserves hashed
`_astro/` assets for open browser tabs; the bucket lifecycle expires old hashes.

The site uses the existing static-site identities. Before its first deployment,
the `ci-sites` identity in the `seaweedfs-s3-credentials` 1Password item needs
`Read:glitter-boys`, `Write:glitter-boys`, `List:glitter-boys`, and
`Tagging:glitter-boys` actions. Keep its existing credential and other grants.
The serving identity must also have read access to this bucket.

For an operator-triggered release, use the repository-owned static-site command
with its registered credentials:

```sh
bun run --cwd packages/glitter-boys deploy
```

The existing `ppl.glitter-boys.com` graph has its own package and bucket.
