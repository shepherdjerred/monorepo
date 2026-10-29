---
title: Shop sign examples
description: Write signs that buy, sell, or trade in both directions.
---

A shop sign describes the quantity and crystal price for one trade. Leave its first line blank for your own name.

## Sell items to customers

This sign offers 16 oak planks for 50 crystals. A customer right-clicks to buy them from you.

```text

16
B 50
oak_planks
```

<div><storm-media data-manifest="/media/shop-buy-sign/media.json"><figure><img alt="B 50 lets a customer buy sixteen oak planks for fifty crystals." src="/media/shop-buy-sign/original.webp" width="2560" height="1440" loading="lazy" decoding="async"><figcaption>B 50 lets a customer buy sixteen oak planks for fifty crystals.</figcaption></figure></storm-media></div>
<p><a href="/media/shop-buy-sign/annotated.webp" download>Download annotated image</a></p>

## Buy items from customers

This sign pays 40 crystals for 16 oak planks. A customer left-clicks to sell them to you.

```text

16
S 40
oak_planks
```

<div><storm-media data-manifest="/media/shop-sell-sign/media.json"><figure><img alt="S 40 lets a customer sell sixteen oak planks for forty crystals." src="/media/shop-sell-sign/original.webp" width="2560" height="1440" loading="lazy" decoding="async"><figcaption>S 40 lets a customer sell sixteen oak planks for forty crystals.</figcaption></figure></storm-media></div>
<p><a href="/media/shop-sell-sign/annotated.webp" download>Download annotated image</a></p>

## Combined and unset signs

To offer both directions on one sign, write `B 50:S 40` on the price line. To choose an item by holding it, write `?` on the last line and right-click the finished sign with that item. See [Player shops](/trading/shops/) for where to place the sign and [Managing a shop](/trading/managing-shops/) for stock and balances.

<div><storm-media data-manifest="/media/shop-both-sign/media.json"><figure><img alt="A combined sign offers both prices for the same quantity." src="/media/shop-both-sign/original.webp" width="2560" height="1440" loading="lazy" decoding="async"><figcaption>A combined sign offers both prices for the same quantity.</figcaption></figure></storm-media></div>
<p><a href="/media/shop-both-sign/annotated.webp" download>Download annotated image</a></p>

<div><storm-media data-manifest="/media/shop-unset-sign/media.json"><figure><img alt="A question mark leaves the item unset until the owner selects it." src="/media/shop-unset-sign/original.webp" width="2560" height="1440" loading="lazy" decoding="async"><figcaption>A question mark leaves the item unset until the owner selects it.</figcaption></figure></storm-media></div>
<p><a href="/media/shop-unset-sign/annotated.webp" download>Download annotated image</a></p>
