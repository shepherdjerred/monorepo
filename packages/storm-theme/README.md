# Shared Storm theme

`catalog.json` owns the forum and player docs calendar, palettes, logo variants,
scenery, garlands, and festival effects. Generate it and the SVG variants from
`seed-catalog.json` with `bun run generate`; `bun run build` verifies generated
output and bundles the browser adapter. TypeScript and XenForo validate the same
language-neutral catalog.

The browser adapter follows System appearance by default and saves explicit
appearance, theme, and effects preferences through the forum's native style
handler. The shared cookie uses the apex domain in production. Reduced motion
disables effects; seasonal themes have no falling particles.

`renderCard` produces deterministic 1200×630 PNGs using Satori, Resvg, local fonts,
and owned artwork. The public forum endpoint chooses the operator's calendar
theme independently of visitor preferences, checks guest visibility, and caches
cards by content and renderer/artwork revision. `docs.json` lists public player
documentation paths and titles; its test checks the actual Markdown pages.
Both test tasks hash those external pages. Verification explicitly selects the
theme tests for page edits because the docs already depend on this theme, so a
reverse workspace dependency would create a cycle.

## Original branding

`assets/logo.svg` is the original cloud wordmark. `assets/brand/` holds the
archived cloud TS mark, classic outlined favicon, animated advertising banner,
and selected photographs. Its README records the original files and dates.
Keep those masters intact. Seasonal logo colors and site scenery continue to
come from the catalog; social cards use the real archived `assets/spawn.jpg`.

`bun run generate` renders the square icons, PNG wordmark, social cards and
content-derived artwork revision. `bun run build` checks those exports before
bundling. The forum and docs include the revision in public share-image URLs,
and the forum includes it in its image-cache identity. Platform-specific files
under The Storm's server and promotion packages are exports of these masters.
