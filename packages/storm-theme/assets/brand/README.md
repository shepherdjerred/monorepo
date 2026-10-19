# Original Storm brand assets

These selected originals come from Jerred's `The Storm/Assets` archive. They are
owned Storm artwork and screenshots. The existing parent `logo.svg` is the
archived cloud wordmark, and `spawn.jpg` is the archived April 2016 spawn view.

| Master           | Archived source                                                | Use                                                                                                      |
| ---------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `mark.svg`       | `docs/logo__20221123085717.svg`                                | Original 250×250 cloud-backed TS, including its slate background; server, profile and application icons. |
| `favicon.svg`    | `docs/favicon__20240815013505.svg`                             | Classic outlined TS; SVG and PNG browser favicons.                                                       |
| `favicon.ico`    | `site/tsmc_favicon_20151030.ico`                               | Original 16px and 32px favicon.                                                                          |
| `banner.gif`     | `offsite/the-storm_banner-468x60_pmc-607925_mcf-sig_mcso.gif`  | Original 468×60 animated rain/lightning ad, 90 frames, 2.7-second loop, 353725 bytes.                    |
| `windmill.png`   | `site/tsmc_attach133_2015-01-26_16-41-51_20160323135151.png`   | January 2015 windmill screenshot.                                                                        |
| `spawn-town.png` | `site/tsmc_attach134_2015-01-26_16-45-01_20160323135542.png`   | January 2015 fountain plaza screenshot.                                                                  |
| `mob-arena.jpg`  | `offsite/pmc-storm_2015-10_screenshot_ma9545179_mob-arena.jpg` | October 2015 Mob Arena screenshot, with its original watermark.                                          |

`scripts/render-brand.ts` renders `icon-64/180/192/512.png`, `favicon-32/48.png`,
`wordmark.png`, `social.png` and `livemap-social.png`. Run it through the package's
`generate` command; `--check` compares the actual bytes. `revision.txt` hashes the
catalog and rendered social artwork for share-image cache invalidation.

The static `banner.png` and `banner.jpg` are the original GIF's opening frame,
exported with Sharp (JPEG quality 95, background `#052c2b`). `windmill.jpg` and
`spawn-town.jpg` are 1280px-wide JPEG exports (quality 85, no enlargement) for
homepage delivery. Originals remain available above. Preserve image proportions,
watermarks and archival captions; these are historical photographs, not evidence
of the current world's features or player population.
