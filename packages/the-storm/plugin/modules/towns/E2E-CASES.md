# Towns protection: real-server cases

MockBukkit cannot simulate these, so the rules behind them are covered by pure
domain tests and these scenarios belong in the real-server suite
(`packages/the-storm/tests/e2e`). Each names the listener that handles it.
"Outsider" is a player who is not a member of the town that owns the claim.

## Pressing and trampling (`MobListener.onEntityInteract`)

- An outsider drops an item onto a town's pressure plate from the wilderness:
  the plate stays up. (MockBukkit does not implement `Item#setThrower`.)
- An outsider rides a horse, or leads a mob on a lead, onto a town's plate or
  farmland: nothing happens.
- A zombie that spawned in the wilderness walks onto a town's plate: the plate
  stays up. A villager born in the town presses it.

## Redstone (`BlockListener.mayWire`, `WorldListener.onRedstone`, pistons)

- An outsider places a torch, lever, button or dust in the wilderness beside a
  town's door, trapdoor, gate or piston: the placement is refused.
- A redstone block that was already in the wilderness (placed before the claim)
  powers a solid block beside a town's door: the door stays shut. Same with the
  door's other half and with a piston's quasi-connected block above.
  (MockBukkit does not implement `Block#getBlockPower`, and the door event only
  fires on a real redstone update.)

## Dispensers and untraced damage (`CombatListener`)

- A dispenser in the wilderness fires arrows at a player standing in a town
  with PvP off: no damage. The same dispenser inside the town hurts them.
- A dispenser in the wilderness fires splash or lingering harming potions into
  a town: players and animals in the town are unaffected.
- TNT primed by redstone in the wilderness explodes beside a PvP-off town: the
  players inside take no damage (their blocks are already protected).

## Shelves and double chests (`InteractListener`, `BlockListener`, `WorldListener`)

- A shelf in the wilderness beside a row of town shelves: an outsider cannot
  swap items through it, nor place a shelf that joins the town's row.
- A double chest straddling a claim border: an outsider cannot open the wild
  half, and a hopper under the wild half cannot drain it.

## Raids, withers, boats (`MobListener.onRaid`, `WitherListener`, `EntityListener`)

- An outsider with Bad Omen walks into a town's village: no raid starts.
- An outsider builds a wither on soul sand within 8 chunks of a town or spawn:
  the last skull is refused. A wither built elsewhere that flies over a town
  breaks nothing there (its builder is an outsider).
- A boat pushed into a town's pen from the wilderness, or ridden by an
  outsider, does not pick up the animals; nor does a boat whose animal an
  outsider holds on a lead.

## Portals (`MovementListener`)

- An outsider walks through a nether portal whose exit is inside a town: the
  trip is refused. The same through an end gateway.
