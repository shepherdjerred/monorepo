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
