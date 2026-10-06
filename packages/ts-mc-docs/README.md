# ts-mc.net docs

Starlight site for `https://docs.ts-mc.net`, the player-facing
documentation of The Storm Minecraft server. Content was ported from
`the-storm-mc/monorepo` with the internal section pruned (it described
decommissioned OVH/Netlify-era infrastructure).

## Content

Player-facing pages only: welcome, norms, world downloads, and the
survival section. Accuracy fixes applied during the port:

- Live map page rewritten for BlueMap at `bluemap.ts-mc.net` (was Dynmap
  at `livemap.ts-mc.net`, which no longer exists).
- World borders corrected against the live ChunkyBorder config
  (`packages/homelab/src/cdk8s/config/minecraft-tsmc/`): Overworld
  20,000, Nether 5,000, End 2,500. The stale Amplified section was
  dropped.
- World downloads are generated from the verified archive catalogue. The
  original formats and player saves are preserved. Bounded 2D previews show
  selected areas around spawn without converting the saves.
- The empty `legacy.md` stub was dropped.

The `world_downloads.md` filename is intentionally underscore-delimited:
it preserves the old MkDocs URL (`/world_downloads/`).

## Brand

Storm identity: teal `#00d0c6`, dark `#303030`/`#101010`, white.
Starlight accent overrides live in `src/styles/custom.css`; the mark is
`src/assets/storm-mark.svg`.

## Analytics

`public/posthog.js` is the managed PostHog snippet, wired in
`astro.config.ts` and verified by
`scripts/checks/check-analytics-sites.ts` (registry key `ts-mc-docs`).

## Develop

```bash
bun run dev
bun run build
bun run typecheck
bun run lint
```

Deploys via `bun run deploy` (SeaweedFS `ts-mc-docs` bucket) and the
`sites` CI lane on `main`.

The bucket's `world-archive/` prefix holds independently published world
downloads and viewers. It is outside this site's build output; the site
deployment excludes it from uploads and pruning. Archive publication and
retirement must target that prefix explicitly.

## Publish the world archive

`archive/catalog.json` declares source filenames, ZIP roots, credits and
Minecraft versions. `archive/published.json` records certified download and
preview hashes, image bounds, dimensions and URLs. World data and images stay
outside Git.

Install `uv`, AWS CLI and `curl` on an Apple Silicon Mac. The publisher downloads
the checksum-pinned uNmINeD CLI from its official site into scratch; its binary
is never redistributed. Use the configured `seaweedfs` AWS profile and choose
an empty scratch directory outside the repository and source directory:

```bash
bun run archive run --source "$HOME/Sync/Sync/The Storm/Worlds" \
  --scratch /path/to/empty/scratch --dry-run
bun run archive run --source "$HOME/Sync/Sync/The Storm/Worlds" \
  --scratch /path/to/empty/scratch
bun run archive document --state /path/to/empty/scratch/published.json
bun run archive verify --state archive/published.json
bun run test
bun run build
```

Publication handles one world at a time and reserves 15 GiB of free disk.
ZIP normalization streams every retained file without extracting the entire
world. It verifies the finished ZIP and reads back S3 objects to compare hashes.
Preview extraction copies only `level.dat` and nearby terrain regions. The
classic 2D renderer reads original chunk formats with two workers, lowered
process priority and a ten-minute process limit. Originals are read-only.

Each world has a 2,048-block-square overview and a 512-block-square close-up
centered on its recorded spawn. Images are trimmed around missing terrain and
capped at 2,048 pixels per side. These are selected areas, not full-world maps.

Rerun with the same scratch directory to skip certified worlds and downloads;
the publisher checks their S3 sizes and hash metadata before trusting a
checkpoint. Missing or changed objects stop the run for storage inspection.
`--only <id>` publishes one world's previews. Download checkpoints are saved
before rendering, so a failed preview never requires reuploading a certified
ZIP. An unfinished world requires inspecting its logs and removing that exact
scratch child before retrying. Keep `published.json` until the complete release
has been documented. Uploads also check existing objects when scratch is fresh:
different bytes at an immutable URL stop publication. Changed sources or ZIP
packaging require a new release identifier.

Use `--workers 1` to reduce preview concurrency further. Preview metadata drops
trailing junk after a valid gzip stream when an old export contains it; the
download keeps those original bytes.

Previews are ordinary PNG files and require no viewer or live server.
Publication never deletes remote objects. The normal docs deploy excludes
`world-archive/*` from its deleting sync; retain that protection when changing
the deployment helper. `verify` separately checks every public download and
preview, including exact byte ranges for downloads through the serving stack.

To preserve a browsable gallery independently of later docs deployments, build
a static snapshot with Astro's base path set to the release prefix. Replace
`<release>` with the certified manifest's release and use an empty output
directory outside the repository:

```bash
bun run astro build --base /world-archive/<release>/site/ --outDir /path/to/snapshot
AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED \
AWS_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED \
aws --profile seaweedfs --endpoint-url https://seaweedfs-s3.tailnet-1a49.ts.net \
  s3 sync /path/to/snapshot s3://ts-mc-docs/world-archive/<release>/site/ \
  --cache-control no-cache
```

The snapshot gallery is at `/world-archive/<release>/site/world_downloads/`.
Inspect the rendered gallery and its full-size images after uploading. Snapshot
uploads use no deleting sync and do not include local world data.
