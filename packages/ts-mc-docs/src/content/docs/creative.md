---
title: How to build in creative
description: Enter the creative plot world, claim a cell, merge a neighbor, and rate a plot.
---

Creative is a separate plot world with its own inventory.

Run `/creative` to enter. You arrive at the glowstone crossing and switch to creative mode with an empty inventory. Your survival items, experience, and effects stay stored until you leave. Run `/creative leave` to restore that survival body. Creative items, experience, and effects are discarded when you leave. `/plot` remains the survival shop-rental command.

Leaves do not decay there, fire does not spread, and crops, vines, and snow do not grow on their own. Place the block you want.

The playable border is a circle centered at 0, 0 with a radius of 1,500 blocks.
Recovered builds and ownership outside that circle remain saved, but cannot be visited or claimed through normal play.

## Claim a cell

Stand on an empty cell inside the world border and run `/creative claim`. When the claim is saved, you arrive at the center of that plot. You can hold two new claims. Plots already listed in the recovered catalog do not count toward that cap. Staff are exempt from the cap.

`/creative auto` claims the nearest free cell that sits fully inside the border and takes you to its center. A road, a staff-held plot, and a plot someone else owns cannot be claimed.

## Name, trust, and visit

Stand on a plot you own:

1. `/creative name <name>` sets a name of up to 32 characters.
2. `/creative desc <description>` sets a description of up to 140 characters.
3. `/creative member <player>` lets that online player build. `/creative unmember <player>` removes them.
4. `/creative trust <player>` lets that online player build and add or remove members. `/creative untrust <player>` removes them.
5. `/creative deny <player>` stops that online player from entering the plot or being teleported into it. `/creative undeny <player>` allows them again. Only the owner can trust, deny, or change an existing role. A trusted player can add and remove members.
6. `/creative home` returns you to a plot you can already build on. `/creative home 2;1` goes to that plot when you own it, are a member, or are trusted there.
7. `/creative tp 2;1` visits that plot. A denied player cannot. Staff with `thestorm.creative.bypass` or `thestorm.creative.admin` still can.
8. `/creative flag use on` lets a visitor use doors, buttons, and other blocks on that plot. `/creative flag use off` turns it off. The flags are `pvp`, `use`, `vehicle`, `mob-interact`, and `explosion`. They start off. Break and place stay with the owner, members, and trusted players. A flag does not change leaf decay, fire spread, or the other world rules.
9. `/creative floor sand` stores a floor for the plot you own. `/creative wall quartz` and `/creative biome desert` store the wall and biome. The choice is remembered and does not change the blocks already on the plot. Grass, stone, and plains are the generator defaults.
10. `/creative clear confirm` restores the plot you own, including its wall, to the generator and the floor, wall, and biome you stored. It does not change the road. `/creative reset` puts the flags, floor, wall, and biome back to the defaults and leaves the blocks, members, name, and description as they are. On a merged plot, reset clears the flags on every plot in that merge and restores the floor, wall, and biome of the plot you are standing on. `/creative unclaim` removes a plot you claimed yourself once that plot matches the generator again and is not merged. A recovered plot stays with staff.
11. `/creative merge 2;1` links the plot you are standing on with `2;1` when you own both and they share a side. A diagonal neighbor does not count. The road between them stays. You can build on that road. `/creative unlink` separates them once that road matches the template again. Each plot keeps its own name, description, floor, wall, and biome. Members, the deny list, and flags are copied onto each plot. Unlink a merged plot before you unclaim it.
12. `/creative save house` copies the one plot you are standing on into your schematic library. The copy is that plot only, not a merged neighbor and not the road. `/creative load` lists your names. `/creative paste house` puts one back onto the plot you own, and only when that plot matches the generator. A schematic that is not one plot, or that contains a command block, chain command block, repeating command block, structure block, jigsaw, or command minecart, is refused. Names are letters, numbers, `_`, or `-`, up to 32 characters.
13. `/creative rate 5` records one score from 1 through 5 for the claimed plot you are visiting. Rating again replaces your score. `/creative comment A quiet dock` adds a public comment of up to 140 characters. A plot keeps up to 20 comments. `/creative comment delete` removes the latest comment when you own the plot, and your own latest comment otherwise. A denied player cannot rate or comment.
14. `/creative info` and `/creative list` show the plot you are on and the plots you can build on. On a claimed plot, info also shows the average rating, how many players rated, and the latest three comments.

## Download one plot

Stand on a plot you own or are trusted on and run `/creative download`. The server saves that one plot as a file for you to fetch outside the world. The file is not mailed, and it does not travel through survival. `/creative save`, `/creative load`, and `/creative paste` are a separate library of your own plot copies. Download does not list that library.

## Creative map

Claimed and staff-held plots are labelled on the map named creative. The label is the plot's name when one is set, and the owner's username otherwise. A plot with neither is labelled staff. That map is on the same [LiveMap](https://bluemap.ts-mc.net/) site as survival: [creative](https://bluemap.ts-mc.net/#creative). Empty cells are not marked. Survival town markers stay on the survival map.

WorldEdit in this world changes the plot you are standing in. When that plot is merged, the edit may also cover the other plots in the merge and the road between them. You can change them when you own the plot, are a member, or are trusted there. A road that is not between merged plots, or an edit that leaves the merge, is refused.
