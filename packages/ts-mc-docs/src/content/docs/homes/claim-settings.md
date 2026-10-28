---
title: Claim settings
description: Set access and protection flags for a claimed chunk.
---

Owners and assistants can set protection and public access separately for each claimed chunk.

Stand in the chunk and use `/claim info` to check its current settings. Change one with `/claim flag <flag> <true|false>`, such as `/claim flag pvp false`. New claims have PvP on and the other flags off.

| Flag              | What turning it on allows                                         |
| ----------------- | ----------------------------------------------------------------- |
| `pvp`             | Players can fight each other.                                     |
| `explosions`      | Explosions can affect the land.                                   |
| `fire-spread`     | Fire can spread.                                                  |
| `mob-griefing`    | Mobs can affect the land.                                         |
| `public-build`    | Outsiders can build and open unlocked containers.                 |
| `public-switches` | Outsiders can use doors and redstone controls.                    |
| `public-entities` | Outsiders can use and harm protected entities, including animals. |

To grant one outsider access without opening the chunk to everyone, use `/claim trust <player>`. Remove that access with `/claim untrust <player>`. Locks still apply; see [Managing locks](/homes/managing-locks/).
