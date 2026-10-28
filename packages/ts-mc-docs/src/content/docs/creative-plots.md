---
title: Manage creative plots
description: Set plot permissions and options, invite builders, and visit plots.
---

Manage a plot you own in the [creative world](/creative/).

## Name, trust, and visit

| Role    | Build | Manage members | Trust or deny players |
| ------- | ----- | -------------- | --------------------- |
| Owner   | Yes   | Yes            | Yes                   |
| Trusted | Yes   | Yes            | No                    |
| Member  | Yes   | No             | No                    |
| Visitor | No    | No             | No                    |

Visitors can use permitted interactions when the owner enables the relevant flag. Denied players cannot enter.

Stand on a plot you own:

- `/creative name <name>` sets a name of up to 32 characters. `/creative desc <description>` sets a description of up to 140 characters.
- `/creative member <player>` lets that online player build. `/creative unmember <player>` removes them.
- `/creative trust <player>` lets that online player build and add or remove members. `/creative untrust <player>` removes them.
- `/creative deny <player>` stops that online player from entering the plot or being teleported into it. `/creative undeny <player>` allows them again. Only the owner can trust, deny, or change an existing role. A trusted player can add and remove members.
- `/creative home` returns you to a plot you can already build on. `/creative home 2;1` goes to that plot when you own it, are a member, or are trusted there.
- `/creative tp 2;1` visits that plot. A denied player cannot. Staff with `thestorm.creative.bypass` or `thestorm.creative.admin` still can.

## Set plot options

`/creative flag use on` lets a visitor use doors, buttons, and other blocks on that plot. `/creative flag use off` turns it off. The flags are `pvp`, `use`, `vehicle`, `mob-interact`, and `explosion`. They start off. Break and place stay with the owner, members, and trusted players. A flag does not change leaf decay, fire spread, or the other world rules.

To change the saved floor, wall, or biome, see [merge and maintain plots](/creative-plot-maintenance/).

## Clear or unclaim

See [merge and maintain plots](/creative-plot-maintenance/) before clearing or unclaiming a plot.

## Merge plots

See [merge and maintain plots](/creative-plot-maintenance/) to join neighboring plots or separate them again.

## Save and restore a copy

See [save and download creative plots](/creative-plot-copies/) for schematic copies and downloads.

## Rate and inspect plots

`/creative rate 5` records one score from 1 through 5 for the claimed plot you are visiting. Rating again replaces your score. `/creative comment A quiet dock` adds a public comment of up to 140 characters. A plot keeps up to 20 comments. `/creative comment delete` removes the latest comment when you own the plot, and your own latest comment otherwise. A denied player cannot rate or comment.

`/creative info` and `/creative list` show the plot you are on and the plots you can build on. On a claimed plot, info also shows the average rating, how many players rated, and the latest three comments.
