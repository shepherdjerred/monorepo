---
title: Save and download creative plots
description: Save a plot to your schematic library or export it outside the world.
---

Make a copy of one creative plot to restore it later or fetch it outside the world.

## Save and paste a schematic

1. Stand on your plot and use `/creative save house`. The copy contains that plot only, not a merged neighbor or the road.
2. Use `/creative load` to list your saved names. Names can contain letters, numbers, `_`, or `-`, up to 32 characters.
3. Stand on a plot you own that matches the generator, then use `/creative paste house` to restore the copy.

<div><storm-media data-manifest="/media/creative-saved-library/media.json"><figure><img src="/media/creative-saved-library/original.webp" width="2560" height="1440" loading="lazy" alt="Save the plot as DocsGazebo, then list the genuine schematic library with /creative load." /><figcaption>Save the plot as DocsGazebo, then list the genuine schematic library with /creative load. <a href="/media/creative-saved-library/annotated.webp">Download annotated image</a>.</figcaption></figure></storm-media></div>

<div><storm-media data-manifest="/media/creative-restored-build/media.json"><figure><img src="/media/creative-restored-build/original.webp" width="2560" height="1440" loading="lazy" alt="The gazebo returns through /creative paste; its restored block states match the saved original." /><figcaption>The gazebo returns through /creative paste; its restored block states match the saved original. <a href="/media/creative-restored-build/annotated.webp">Download annotated image</a>.</figcaption></figure></storm-media></div>

The server refuses schematics that are not one plot or contain a command block, chain command block, repeating command block, structure block, jigsaw, or command minecart.

## Download a plot

Stand on a plot you own, are a member of, or are trusted on and use `/creative download`. The server saves that one plot as a file. Ask staff to retrieve it for you; it is not mailed and does not travel through survival. Downloads are separate from your personal schematic library; the download command does not list that library.

See [creative plots](/creative-plots/) for plot roles and [plot maintenance](/creative-plot-maintenance/) for clearing and merging.
