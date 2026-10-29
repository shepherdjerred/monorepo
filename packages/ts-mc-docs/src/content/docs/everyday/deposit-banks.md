---
title: Deposit banks
description: Send matching items from a deposit container to nearby storage shelves.
---

A deposit bank moves items from one container into linked shelves. It is useful when you want to drop off supplies without opening each storage chest.

1. Put a sign with `[Bank]` on the first line on a chest, barrel, copper chest, or dispenser.
2. Put a `[Shelf]` sign on another supported container nearby. On the following lines, name the items it should accept, such as `cobblestone` or `oak_planks`.
3. Put matching items in the bank container and close it. They move to a matching shelf with room. Items without a matching shelf or enough room stay in the bank.

<div><storm-media data-manifest="/media/deposit-bank/media.json"><figure><img alt="A deposit bank barrel beside a shelf accepting cobblestone and oak planks" src="/media/deposit-bank/original.webp" width="2560" height="1440" loading="lazy" decoding="async"><figcaption>Closing the bank sends matching items to its linked shelf.</figcaption></figure></storm-media></div>
<p><a href="/media/deposit-bank/annotated.webp" download>Download annotated image</a></p>

For example, label a shelf `cobblestone` and `oak_planks`, then put those items and spruce logs in the bank.

<div><storm-media data-manifest="/media/bank-deposit/media.json"><figure><img alt="Cobblestone, oak planks, and spruce logs placed in the deposit bank" src="/media/bank-deposit/original.webp" width="2560" height="1440" loading="lazy" decoding="async"><figcaption>Put supplies in the bank, then close it to route matching items.</figcaption></figure></storm-media></div>
<p><a href="/media/bank-deposit/annotated.webp" download>Download annotated image</a></p>

Open the shelf after closing the bank. The cobblestone and oak planks have moved there; the logs stay in the bank unless another shelf accepts them.

<div><storm-media data-manifest="/media/bank-delivered/media.json"><figure><img alt="Sixteen cobblestone and twelve oak planks have arrived in the linked shelf barrel" src="/media/bank-delivered/original.webp" width="2560" height="1440" loading="lazy" decoding="async"><figcaption>The shelf receives both accepted item types.</figcaption></figure></storm-media></div>
<p><a href="/media/bank-delivered/annotated.webp" download>Download annotated image</a></p>

Shelf signs must be within 64 blocks of the bank. The usual limit is eight banks per player and 32 shelves per bank. A hopper delivery or redstone can also trigger a deposit. Land and container locks still control access, so check those if a shelf cannot receive items.

If nothing moves, check the item name on the sign, the distance, and whether the shelf has space. Look at the bank and use `/bank` to inspect it. Check claim and lock access too; see [Managing locks](/homes/managing-locks/) for hopper and redstone settings.

See [deposit shelves](/everyday/advanced/bank-shelves/) for filters and troubleshooting.
