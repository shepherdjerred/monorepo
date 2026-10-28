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

## Buy items from customers

This sign pays 40 crystals for 16 oak planks. A customer left-clicks to sell them to you.

```text

16
S 40
oak_planks
```

To offer both directions on one sign, write `B 50:S 40` on the price line. To choose an item by holding it, write `?` on the last line and right-click the finished sign with that item. See [Player shops](/trading/shops/) for where to place the sign and [Managing a shop](/trading/managing-shops/) for stock and balances.
