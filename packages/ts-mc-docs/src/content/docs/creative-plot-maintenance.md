---
title: Merge and maintain creative plots
description: Merge neighbors, restore a plot, or return a claim.
---

Manage the shape and ground of plots you own in the [creative world](/creative/).

## Set the ground and biome

Stand on your plot and use `/creative floor sand`, `/creative wall quartz`, or `/creative biome desert` to store a choice. These commands do not change existing blocks. Grass, stone, and plains are the generator defaults.

## Merge and unlink

Stand on a plot you own and use `/creative merge 2;1` to join it to a plot at `2;1` that you also own. They must share a side, not just a corner. The road between them stays, and you can build on it.

<div><storm-media data-manifest="/media/creative-merged-plots/media.json"><figure><img src="/media/creative-merged-plots/original.webp" width="2560" height="1440" loading="lazy" alt="Merge neighboring plots you own; their road remains in place." /><figcaption>Merge neighboring plots you own; their road remains in place. <a href="/media/creative-merged-plots/annotated.webp">Download annotated image</a>.</figcaption></figure></storm-media></div>

Use `/creative unlink` once the road between them matches the template again. Each plot keeps its own name, description, floor, wall, and biome. Members, the deny list, and flags are copied onto each plot.

## Clear, reset, or unclaim

`/creative clear confirm` restores your plot and its wall to the generator using your stored floor, wall, and biome. It does not change the road. Consider [saving a copy](/creative-plot-copies/) first.

`/creative reset` returns the flags, floor, wall, and biome to defaults without changing blocks, members, name, or description. On a merged plot, it resets flags across the merge and the floor, wall, and biome of the plot you stand on.

`/creative unclaim` removes a plot you claimed yourself once it matches the generator and is no longer merged. Unlink it first if needed. A recovered plot stays with staff.
