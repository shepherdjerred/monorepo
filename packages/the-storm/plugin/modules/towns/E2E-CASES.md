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

## Lesser holes (`ContactListener`, `FireListener`, `WorldListener`, `MobListener`, `BlockListener`)

- An outsider picks up an item lying in a town: refused. They pick up what they
  dropped there, and their own drops after dying there. (MockBukkit does not
  implement `Item#getThrower` or `Item#setThrower`.)
- An outsider walks into a town's cow or boat to push it out of its pen: it
  does not move. A town member pushes it.
- A TNT cannon in the wilderness lands primed TNT inside a town that allows
  explosions: no town blocks break (the blast is judged from where the TNT was
  lit). A creeper that spawned in the wilderness blows up inside a town: same.
- A hopper minecart rolled in on rails from the wilderness passes under a
  town's chest: it takes nothing. A cart a member placed in the town loads.
- An outsider breaks the wilderness block a town's item frame or painting hangs
  on: refused.
- An outsider leads a sheep into a town: it does not eat the town's grass.
- An outsider's footsteps or arrows near a town's sculk sensor do not power its
  redstone; near its shrieker they do not summon a warden.
- Lightning (natural or channeling) strikes a town's villager or pig: it stays
  a villager or pig.
- A spear charge or mace smash by an outsider unseats a town's mounted player
  or knocks a town's animal: no knockback, and the town's animal does not turn
  on the outsider (lastHurtByMob side effects).
- An outsider hits another player's wolf in the wilderness: no damage (tamed
  pets are protected from everyone but their owner, everywhere).
