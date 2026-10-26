---
title: How to build in creative
description: Enter the creative plot world, claim a cell, name it, trust a builder, and download it.
---

This page describes the creative plot commands. It is not a statement that creative is on the live server.

Run `/creative` to enter. You switch to creative mode with an empty inventory. Your survival items, experience, and effects stay stored until you leave. Run `/creative leave` to restore that survival body. Creative items, experience, and effects are discarded when you leave. `/plot` remains the survival shop-rental command.

Leaves do not decay there, fire does not spread, and crops, vines, and snow do not grow on their own. Place the block you want.

## Claim a cell

Stand on an empty cell inside the world border and run `/creative claim`. You can hold two new claims. Plots already listed in the recovered catalog do not count toward that cap. Staff are exempt from the cap.

`/creative auto` claims the nearest free cell that sits fully inside the border. A road, a staff-held plot, and a plot someone else owns cannot be claimed.

## Name, trust, and visit

Stand on a plot you own:

1. `/creative name <name>` sets a name of up to 32 characters.
2. `/creative desc <description>` sets a description of up to 140 characters.
3. `/creative trust <player>` lets that online player build. `/creative untrust <player>` removes them.
4. `/creative home` returns you to a plot you can visit. `/creative home 2;1` goes to that plot when you own it or are trusted there.
5. `/creative info` and `/creative list` show the plot you are on and the plots you can visit.

## Download one plot

Stand on a plot you own or are trusted on and run `/creative download`. The server saves that one plot as a file for you to fetch outside the world. The file is not mailed, and it does not travel through survival.

## Creative map

Claimed and staff-held plots are labelled on the map named creative. The label is the plot's name when one is set, and the owner's username otherwise. A plot with neither is labelled staff. That map is on the same [LiveMap](https://bluemap.ts-mc.net/) site as survival: [creative](https://bluemap.ts-mc.net/#creative). Empty cells are not marked. Survival town markers stay on the survival map.

WorldEdit in this world changes only the single plot you are standing in, and only when you own it or are trusted there. A road, or an edit that leaves the plot, is refused.
