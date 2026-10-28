---
title: Locks
description: Protect containers and share access with people you trust.
---

New containers, doors, trapdoors, fence gates, item frames, and armor stands lock automatically for the player who places them. Signs can be locked too, but do not lock automatically. A lock controls access separately from the rules of the land around it.

Look at the block or object while using these commands:

- `/lock` creates a private lock; `/lock info` shows its details.
- `/lock trust <player>` lets someone use it. `/lock untrust <player>` removes that access.
- `/lock share on` shares it with your town; `/lock share off` turns that sharing off.
- `/unlock` removes your lock. Claim rules still apply on claimed land.

Only share access with people you trust. If someone cannot open a chest on shared land, check both the land access and the chest's lock. A double chest counts as one lock; each player can hold up to 64 locks.

For example, to share a supply chest with a friend, make sure they can access its chunk, then look at the chest and use `/lock trust <player>`. Ask them to try opening it. If it still fails, inspect the chunk with `/claim info` and the chest with `/lock info`.

For access levels, lock types, and automatic locking options, see [Managing locks](/homes/managing-locks/).
