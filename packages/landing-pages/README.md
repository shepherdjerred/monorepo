# Landing pages

Static Astro site served at `https://public.ts-mc.net` from the `landing-pages`
bucket. It is the shared host for landing and campaign pages, such as ad
destinations, across projects. Each page is an _item_.

| Item        | URL                                   | Purpose                                |
| ----------- | ------------------------------------- | -------------------------------------- |
| `the-storm` | `https://public.ts-mc.net/the-storm/` | Pinterest ad destination for The Storm |

The root lists the items and is not indexed. `404.astro` covers unknown paths.

## Adding an item

1. Create `src/pages/<item>/index.astro` and keep the item's layout, CSS,
   fonts, scripts and images in `src/items/<item>/`.
2. Render through `src/layouts/Base.astro` with `pageKey="<item>"`. It sets
   the head metadata, the optional share image, and the PostHog tracker.
3. Add any third-party tracker as `public/<item>/<name>.js`, gated on the
   `public.ts-mc.net` hostname and the `/<item>/` path prefix. Allow its hosts
   in `landingPagesCsp` (`packages/homelab/.../s3-static-sites/sites.ts`) and
   register it in `scripts/checks/check-analytics-sites.ts`.
4. Add the item to the table above and to the root index. Add an
   `http_200_no_redirect` probe for its route in the static-site entry.

## Tracking

`public/posthog.js` is the host tracker. Every event carries
`site_key: "landing-pages"` and the item's `page_key`. Campaign parameters
(`utm_*`, Pinterest `epik`) stay in the URL, and PostHog records them as-is.

The Storm item adds:

- An address card with a Java/Bedrock toggle and one copy button for the
  selected edition. Phones and tablets open on Bedrock. Java shows "26.3 &
  older": the server runs 26.3, and ViaBackwards admits older clients. Bedrock
  says "latest version", because its support follows the live Geyser build.
- Join steps and a console section (`#consoles`) live on the page itself, so
  visitors from an ad don't have to leave for the docs. Consoles have no Add
  Server button, so the section walks through BedrockConnect's DNS method.
- Addresses come from `packages/storm-forum/config/forum.json`. The build fails
  if the Java version stops matching the server image, the Discord invite stops
  matching the docs config, or the BedrockConnect DNS addresses stop matching
  the docs join page.
- PostHog events `storm_server_address_copied` and `storm_edition_selected`
  (`edition`), plus `storm_discord_clicked`, `storm_docs_clicked`,
  `storm_join_steps_clicked` and `storm_console_steps_clicked` (`placement`).
- `public/the-storm/pinterest.js`, which loads Scout's shared advertiser tag
  `2612722784413`, the same one used by the forum portal. It skips visitors
  with Do Not Track or Global Privacy Control set. It sends `pagevisit`, one
  `lead` the first time an address is copied, and one `custom`
  `storm_discord_clicked`.

Ad destination URLs use
`https://public.ts-mc.net/the-storm/?utm_source=pinterest&utm_medium=paid&utm_campaign=the-storm&utm_content=<two-digit-pin-number>`.

## The Storm item

Copy stays casual and lowercase, like the ads; visitors arrive from Pinterest,
not from the docs. The design follows the friendly Pinterest set: Outfit and
Lora italic, cream, lilac and sage grounds, and rounded paper frames. The
screenshots are owned January 2015 Storm originals from the same archive as the
ads (the windmill from `@shepherdjerred/storm-theme` brand assets, plus the
clock tower and town house). They are exported as JPEG quality 90, and Astro
generates responsive AVIF and WebP from them.

The page targets every common screen from a 280px folding phone to a 3840px
monitor in Safari, Chrome, Firefox and Edge. Below 960px the address card comes
before the photo, so it is on an ad visitor's first screen; wider screens keep
the content in one centred `--page` column. Styles are inlined, and fonts come
from the installed Fontsource files through Astro's font API with
metric-matched fallbacks, so text paints immediately without a later shift.

## Development

```bash
bun run dev      # http://localhost:4321/the-storm/
bun run build    # astro check, tsc, astro build
bun run deploy   # publish an archive through Delivery
```
