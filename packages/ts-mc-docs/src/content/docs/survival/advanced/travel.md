---
title: Travel commands in detail
description: Manage homes, requests, warps, and teleport costs.
---

Save destinations and check your price before travelling by command.

## Homes and destinations

- `/sethome <name>` saves your location; `/homes` lists homes. Use `/home <name>` to return and `/delhome <name>` to remove one.
- You can save three homes. Your latest bed saves a separate `bed` home without using a slot. `/home` without a name prefers it.
- `/warp` lists public warps; `/warp <name>` travels to one. `/spawn` returns to the windmill.
- `/back` returns to a previous teleport or death location. It remembers up to five locations.

Land permissions can prevent a teleport into a destination.

## Visit another player

Use [teleport requests](/survival/advanced/teleport-requests/) to visit another player or invite them to you.

## Prices and timing

Use `/tpinfo` or `/tpinfo <category>` for your current price, cooldown, and readiness. Each category has its own cooldown, which starts on arrival. The usual prices are:

| Command                              | Crystals | Cooldown   |
| ------------------------------------ | -------: | ---------- |
| `/spawn`                             |       10 | 30 seconds |
| `/home`, `/back`, `/tpa`, `/tpahere` |       25 | 1 minute   |
| `/warp`                              |       15 | 30 seconds |
| `/rtp`                               |       25 | 1 minute   |

Random teleport is free for your first seven days, but still has a cooldown. Teleports normally have a three-second warmup; moving a block or taking damage cancels it. Leaving spawn skips the warmup. Failed or cancelled trips do not charge you. Combat tags block travel; see [PvP and combat tags](/survival/advanced/combat/).

Your starter compass offers a complimentary first random teleport without the command's price, warmup, or cooldown.
