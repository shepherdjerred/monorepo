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
  selected areas around spawn without converting the saves. Static BlueMap
  overviews cover all saved terrain using disposable render copies.
- The empty `legacy.md` stub was dropped.

The `world_downloads.md` filename is intentionally underscore-delimited:
it preserves the old MkDocs URL (`/world_downloads/`).

## Brand

Flexile chrome, calendar palettes, holiday logos, scenery, and effects come from
`@shepherdjerred/storm-theme`. `public/storm` links to its owned assets. Starlight
component overrides share System appearance and saved preferences with XenForo;
page-specific social metadata uses the forum's public calendar card endpoint.
Production account navigation and preference synchronization activate with the
production entry in the forum's GitOps release inventory. Before activation,
docs save appearance locally and publish their own card using the build's
calendar theme. Development uses the local licensed forum preview.

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

## Static world overviews

`bun run overviews` publishes an independent BlueMap viewer for each archived
world. The viewers contain low-resolution PNG tiles and support flat-view
navigation. `enable-hires` is disabled; close-up 3D models are not generated.
`client-decompression` lets the viewer load compressed assets directly from
the existing SeaweedFS bucket through `docs.ts-mc.net`.

Requirements: the repo's Java 25 toolchain, Docker, `uv`, AWS CLI, the configured
`seaweedfs` AWS profile, and the original archive directory.

The publisher resolves Java through `mise` once and uses that binary for both
classpath patch tools and the native renderer, independently of the shell's `PATH`.
Run from this package and choose an empty scratch directory outside the repository
and source:

```bash
bun run overviews run --source "$HOME/Sync/Sync/The Storm/Worlds" \
  --scratch /path/to/overview-scratch --dry-run
bun run overviews run --source "$HOME/Sync/Sync/The Storm/Worlds" \
  --scratch /path/to/overview-scratch --only asterism-2016-02
bun run overviews run --source "$HOME/Sync/Sync/The Storm/Worlds" \
  --scratch /path/to/overview-scratch --workers 4 --render-workers 12
bun run overviews document --state /path/to/overview-scratch/overviews.json --readback
bun run test
bun run build
```

The catalogue's original archive hashes must match the certified downloads.
Extraction copies only terrain and required metadata. The seven listed older worlds
are converted to vanilla 1.17.1 in a disposable, network-isolated Java 17
container using the catalogue's pinned image. The 1.19.2 save renders directly
from a copy. Conversion checks
every original chunk and exits before server startup, so spawn loading cannot
regenerate saved terrain whose old generation flags are incomplete.
Original ZIPs, downloads and preview
images remain unchanged. No converted saves are published.
The overview renders every on-disk chunk without requiring generation-complete
metadata or neighboring light data. This keeps saved terrain visible and renders it fully lit;
the viewer's night mode does not reproduce historical lighting.
Kargeth's Anvil metadata selects its `.mca` terrain; obsolete `.mcr` backups
in that ZIP remain in the download and are excluded from the render copy.
The converter remains before the world-height expansion. `PatchUpgrader.java`
uses Java 25's class-file API to add a synchronous flush before vanilla 1.17.1's
IOWorker closes its asynchronous write queue. Without this flush the converter
can silently discard its final chunk write. The official checksum-pinned JAR
remains unchanged; patched IOWorker and Main classes take precedence on the
disposable converter's classpath. Main exits after the vanilla offline upgrader
has closed and persisted every chunk store. The publisher requires its completion
marker and rejects server-startup output. The patch source checksum is part of the publication
certificate. Every original chunk must pass format certification after conversion.
`PatchRenderer.java` makes BlueMap's three on-disk chunk readers eligible to
render regardless of their generation-status metadata. Older chunks can contain
complete terrain while vanilla conversion marks their status `empty` because
lighting was unfinished. Missing and errored chunk sentinels remain unchanged.
The checksum-pinned BlueMap JAR and world data remain unchanged; patched reader
classes take precedence on the renderer's classpath, and the patch source hash
is part of the certificate. BlueMap's render-state files must contain no failed
or omitted-light tiles and must show a **rendered** tile at every original saved
chunk's center. A `not-generated` result cannot satisfy that check.

Rendering uses the checksum-pinned BlueMap CLI in `archive/overview-tools.json`.
The viewer is built from checksum-pinned matching upstream sources and their
dependency lock using Bun. Vue I18n's JIT compilation handles translations
within the docs site's existing Content Security Policy.
Renderer and viewer versions must agree with the version catalogue. One world
is processed at a time with one to five workers and a 15 GiB free-space reserve.
Conversion partitions disjoint region files across isolated vanilla processes,
then certifies each partition and the merged original chunk inventory. Resume
conversion with the original worker count. Each process has a 5 GiB memory limit;
Docker must have two CPUs per worker and an additional 2 GiB memory margin.
The default is two workers. Extraction
additionally reserves twice the selected terrain's size. Conversion and render
failures retain checkpoints and numbered logs in that world's scratch directory.
`--render-workers` selects independent native rendering parallelism (up to 12
threads, bounded by the host's CPU count). Rendering uses a 4 GiB Java heap with
up to four threads and 8 GiB with more; allow additional host memory headroom.
BlueMap resumes unchanged completed tiles after an interrupted render.
Rerunning resumes completed stages; interrupted extraction requires inspecting
and removing only that exact pipeline-owned world directory before retrying.

Payloads live below `world-archive/<archive-release>/overviews/<overview-release>/`.
Each object is hashed, read back from S3 and checked through its public URL.
Existing objects must match their certificate before a retry skips them.
Changed tools, rendering policy or payload bytes require a new overview release.
Publication never deletes remote objects; the normal site deploy continues to
exclude the entire `world-archive/` prefix.

The catalogue's optional `listed` field defaults to `true`. A `false` value
omits a world from the downloads page and overview rendering without removing
its original archive, stored downloads, previews or publication certificates.
The 2023 upgraded copy of Main Map 1 is unlisted because the original snapshot
is already available.

`document` requires certified overviews for every listed catalogue world, records
`archive/overviews.json`, and regenerates the downloads page with Explore map
links. Later archive documentation updates automatically preserve the checked-in
overview certificate. An explicit certificate can also be selected:

```bash
bun run archive document --state archive/published.json --overviews archive/overviews.json
```

Inspect all hosted viewers and pan beyond spawn before releasing page links.
Keep visual proof with the source change. `document --readback` checks every asset
through both S3 metadata and public bytes before writing page links; it complements
browser acceptance. Use `verify --readback` to repeat that verification without
rewriting the page or its certificate.
