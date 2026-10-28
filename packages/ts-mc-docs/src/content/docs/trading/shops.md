---
title: Player shops
description: Buy and sell items using signs and crystals.
---

Player shops use a sign attached to a stocked container. The sign shows the quantity, item, and price for one trade. Right-click to buy from the shop and left-click to sell to it. A sign can offer either or both directions. You need enough space, items, or crystals for the whole trade.

New spawn market shop rentals may not be open to every player. A shop can also be made wherever you have the required permissions.

![A preserved player-built shop in the old market](/screenshots/historic-market-shop.webp)

The old market includes preserved player-built shops. Historical signs may use an older format; use the format below for a new shop.

## Make a shop

You need Shopkeeper I and permission to build and open the container. Place a sign on a chest or barrel and write four lines:

```text

16
B 50:S 40
oak_planks
```

Leave the first line blank to use your name. In this example, a customer buys 16 oak planks for 50 crystals or sells 16 for 40 crystals. You can leave out either price. Put items in the container to stock your shop, and keep enough crystals in your balance if you want to buy items from customers.

You can write `?` on the item line instead, then right-click the finished sign while holding the item to set it. To change a shop sign, break it and make a new one. Look at a shop and use `/shop info` to see its details.

[Shop sign examples](/trading/shop-sign-examples/) shows how to offer only one trade direction.

See [Managing a shop](/trading/managing-shops/) for shop limits, restocking, and market rentals.

For the distinction between player shops and server-run catalogs, see [NPC shops](/trading/npc-shops/).
