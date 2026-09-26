# Shops: cases for the real-server suite

MockBukkit covers sign creation gating, the right-click container lock,
breaking, machine moves (hoppers, droppers, crafters) and copper golems, explosions, the sign editor, buying and selling
at chest and admin shops, `?` shops with enchanted items, owner notices and
`/shop`. These cases need a real Paper 26.2 server (and Geyser for Bedrock),
because MockBukkit does not implement the API or gets it wrong.

## Chest shops

| Case                                                                                                  | Why not MockBukkit                                                                                                                                 | Expect                                                                                      |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Double chest: a shop sign on one half; buy until the stock on the _other_ half is used                | MockBukkit chests are always single; `Chest#getInventory` is not a double inventory                                                                | Stock and room count both halves; items come out of either half                             |
| Double chest: another player places a chest next to a shop chest                                      | Needs real chest joining (`Chest.Type` LEFT/RIGHT)                                                                                                 | Placement refused ("That would reach into Alice.")                                          |
| Double chest: the other half's `LEFT`/`RIGHT` direction                                               | `DoubleChests.otherHalf` assumes vanilla's rule (LEFT joins clockwise of facing); verify on every facing                                           | Breaking/opening either half is guarded                                                     |
| Opening a shop container through any path other than a right-click (another plugin's `openInventory`) | `Inventory#getLocation` returns the world spawn in MockBukkit for block inventories                                                                | `InventoryOpenEvent` cancelled for non-owners; double chests resolve to one of their halves |
| Hopper under a shop chest, placed by the owner on their own town land                                 | MockBukkit reports every block inventory at the world spawn, so its test only proves the listener; each machine's own location needs a real server | No items flow                                                                               |
| Hopper minecart on rails under a shop chest                                                           | same                                                                                                                                               | No items flow                                                                               |
| Hopper, dropper or crafter pushing into a shop chest                                                  | same; also confirm crafters fire `InventoryMoveItemEvent` when they output into a container                                                        | No items flow                                                                               |
| Copper golem sorting from/into a shop copper chest or chest                                           | Golems are refused through `ItemTransportingEntityValidateTargetEvent`; confirm Paper fires it for both taking and depositing                      | The golem ignores the shop container                                                        |
| A trade in flight: owner tries to open the chest or someone breaks the sign in the same tick          | Needs real async ledger latency                                                                                                                    | Both refused until the trade settles                                                        |
| Left-click (sell) on a shop sign in survival                                                          | Real digging: cancelling the interact event must not let the sign break over time                                                                  | Sign never breaks for non-owners; owners break it normally                                  |
| Sign editor: right-click a shop sign (1.20+ editing)                                                  | `PlayerOpenSignEvent` fired by the real client                                                                                                     | No editor opens                                                                             |
| Owner renames their account                                                                           | Owner name is stored when the shop is made                                                                                                         | Sign still shows the old name (known limitation)                                            |
| Server restart with shops loaded                                                                      | The registry loads from SQLite at enable                                                                                                           | Shops, locks and PDC stamps survive; trades work immediately                                |
| Bedrock player (Geyser) buys and sells at a sign                                                      | Geyser input mapping for left/right click                                                                                                          | Tap = right-click buys; hold/break = left-click sells; confirm the sell gesture is usable   |

## NPC catalogs (dialogs)

`Dialog.create` is unimplemented in MockBukkit, so the dialogs are covered here.
The trade logic behind them (lots, daily limits, pricing, refunds) is unit
tested in `CatalogTradesTest`.

| Case                                                                                      | Expect                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/shop reynolds-supplies` as an admin (Java)                                              | A list dialog titled "Reynold's Supplies" with the greeting and one button per item ("16 Coal"), prices in each tooltip, a Close button                                       |
| Click an item                                                                             | Item dialog: the item icon, "Buy 48 CR · Sell 16 CR for 16 Coal.", a "Trades of 16 Coal" slider 1..16, Buy and Sell buttons, Back                                             |
| Buy 3 trades                                                                              | 48 coal, 144 crystals charged, the item dialog reopens                                                                                                                        |
| Sell emeralds to `braxtons-exchange` past the daily limit (128)                           | Refused with "You can trade N more Emerald today"; the allowance line in the dialog counts down                                                                               |
| Daily limit reset                                                                         | After midnight in `catalogs.dailyResetZone` (America/Los_Angeles) the allowance is full again                                                                                 |
| Walk more than `catalogs.maxDistance` (8) blocks from the shopkeeper, then click a button | "You are too far from ... to trade."; nothing moves                                                                                                                           |
| Tampered dialog response (lots = 0, 999, NaN)                                             | "Choose between 1 and 16 trades."; nothing moves                                                                                                                              |
| Double-click Buy (callback used twice)                                                    | The second click does nothing (`ClickCallback` uses = 1)                                                                                                                      |
| Bedrock player opens a catalog (Geyser → Floodgate form)                                  | The list becomes a simple form of buttons; the item dialog becomes a custom form with the slider and an action dropdown; the item icon is missing but the text names the item |
| NPC module calls `ServerShops.open(player, id)`                                           | Same dialogs as `/shop`                                                                                                                                                       |

## Settlement under real latency

MockBukkit and the unit tests cover the logic with a fake ledger; these need the
real server's scheduler, ledger thread and players.

| Case                                                                  | Expect                                                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Customer logs off right after clicking Buy                            | Charge refunded; nothing given to the offline inventory                                           |
| Customer logs off right after clicking Sell, and the owner cannot pay | Items drop where the customer traded                                                              |
| Server stops (`/stop`) with a trade in flight                         | Trade settles during shutdown, or a `shops_refund_failure` row reads "unsettled at shutdown"      |
| Owner has the shop chest open when a customer trades                  | The owner's chest screen closes; the trade settles                                                |
| Two customers click two signs on one double chest in the same tick    | One trades, the other is told the shop is busy                                                    |
| An autoclicker with empty hands or an empty wallet on a shop sign     | "Slow down" or a refusal on each click; the owner's open chest stays open                         |
| Restart after a catalog edit makes an admin shop loop                 | An ERROR log names the shop id and location; the sign refuses trades; `/shop` lists it for admins |

## Operations

| Case                                                                                                | Expect                                                                |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| A catalog file with a typo, an unknown item, or a price that pays more than another catalog charges | The plugin refuses to start and lists every problem                   |
| `shops_refund_failure` rows                                                                         | Only appear if the ledger refused a refund; staff settle them by hand |
