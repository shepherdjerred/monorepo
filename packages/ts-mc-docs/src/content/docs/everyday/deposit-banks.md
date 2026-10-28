---
title: Deposit banks
description: Send matching items from a deposit container to nearby storage shelves.
---

A deposit bank moves items from one container into linked shelves. It is useful when you want to drop off supplies without opening each storage chest.

1. Put a sign with `[Bank]` on the first line on a chest, barrel, copper chest, or dispenser.
2. Put a `[Shelf]` sign on another supported container nearby. On the following lines, name the items it should accept, such as `cobblestone` or `oak_planks`.
3. Put matching items in the bank container and close it. They move to a matching shelf with room. Items without a matching shelf or enough room stay in the bank.

For example, label a shelf `cobblestone`, then put cobblestone and dirt in the bank. Closing the bank sends the cobblestone to that shelf; the dirt stays unless another shelf accepts it.

Shelf signs must be within 64 blocks of the bank. The usual limit is eight banks per player and 32 shelves per bank. A hopper delivery or redstone can also trigger a deposit. Land and container locks still control access, so check those if a shelf cannot receive items.

If nothing moves, check the item name on the sign, the distance, and whether the shelf has space. Look at the bank and use `/bank` to inspect it. Check claim and lock access too; see [Managing locks](/homes/managing-locks/) for hopper and redstone settings.

See [deposit shelves](/everyday/advanced/bank-shelves/) for filters and troubleshooting.
