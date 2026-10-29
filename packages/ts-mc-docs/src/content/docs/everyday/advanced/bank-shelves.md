---
title: Configure deposit shelves
description: Link storage containers and choose which items they accept.
---

Link shelves to a deposit bank so matching items move into storage when you drop them off.

1. Put a `[Bank]` sign on a chest, barrel, copper chest, or dispenser.
2. Put a `[Shelf]` sign on another supported container within 64 blocks. Name accepted items on the following lines, such as `cobblestone` and `oak_planks`.
3. Put matching items in the bank and close it. Hopper delivery and redstone can also trigger a deposit.

Each nonempty shelf sign line must name an item or say `restack`. The latter compacts matching stacks on that shelf during a deposit. You can also sneak and right-click a linked shelf while holding an item to add that type, if you have permission to add items.

<div><storm-media data-manifest="/media/bank-shelf-types/media.json"><figure><img alt="A shelf sign accepts cobblestone and oak planks on separate lines" src="/media/bank-shelf-types/original.webp" width="2560" height="1440" loading="lazy" decoding="async"><figcaption>Name one accepted item on each nonempty line below [Shelf].</figcaption></figure></storm-media></div>
<p><a href="/media/bank-shelf-types/annotated.webp" download>Download annotated image</a></p>

Unmatched items and items that do not fit remain in the bank. If items do not move, check the names, distance, available space, and access to the land and locked containers. The usual limit is eight banks per player and 32 shelves per bank.

<div><storm-media data-manifest="/media/bank-unmatched/media.json"><figure><img alt="Four spruce logs remain in the deposit bank after the matching items moved" src="/media/bank-unmatched/original.webp" width="2560" height="1440" loading="lazy" decoding="async"><figcaption>Items without a matching shelf stay in the bank.</figcaption></figure></storm-media></div>
<p><a href="/media/bank-unmatched/annotated.webp" download>Download annotated image</a></p>

Look at a bank and use `/bank` to inspect it, or `/bank list` to see its access list. `/bank find <item>` searches nearby accessible shelves for an item.
