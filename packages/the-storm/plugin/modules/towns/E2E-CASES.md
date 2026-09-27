# Towns protection: real-server cases

MockBukkit cannot simulate these, so the rules behind them are covered by pure
domain tests and these scenarios belong in the real-server suite
(`packages/the-storm/tests/e2e`). Each names the listener that handles it.
"Outsider" is a player who is not a member of the town that owns the claim.

## Pressing and trampling (`MobListener.onEntityInteract`)

- An outsider drops an item onto a town's pressure plate from the wilderness:
  the plate stays up. (MockBukkit does not implement `Item#setThrower`.) After
  `grief.thrownItemMemoryTicks` (5 s) the item no longer counts as the
  thrower's; it counts as coming from where it was dropped, so an old item an
  outsider fished or wind-charged onto the plate still does not press it.
- An outsider rides a horse, or leads a mob on a lead, onto a town's plate or
  farmland: nothing happens. A member's pet ridden or led by an outsider counts
  as the outsider's (controllers come first; all must be allowed).
- A zombie that spawned in the wilderness walks, is pushed, lured or boated onto
  a town's plate: the plate stays up. A villager born in the town presses it.

## Redstone (`BlockListener.mayWire`, `WorldListener.onRedstone`, pistons)

- An outsider places a torch, lever, button or dust in the wilderness within
  two blocks (Manhattan distance) of a town's land: the placement is refused.
- A redstone block that was already in the wilderness (placed before the claim)
  powers a solid block beside a town's door: the door stays shut. Same with the
  door's other half and with a piston's quasi-connected block above. (The door
  event only fires on a real redstone update.)
- A piston in the wilderness pushes a redstone block or observer against a
  town's land: the push is refused (`ReReviewRegressionTest` covers the event;
  the resulting redstone needs a real server).

## Dispensers and untraced damage (`CombatListener`)

- A dispenser in the wilderness fires arrows at a player standing in a town
  with PvP off: no damage. The same dispenser inside the town hurts them.
- A dispenser in the wilderness fires splash or lingering harming potions into
  a town: players and animals in the town are unaffected, and a lingering
  cloud landing in the town is not created at all. (MockBukkit does not
  implement `Entity#getOrigin`.)
- A player throws a lingering harming potion and logs out: the cloud still
  answers for them (their id is kept on the cloud).
- TNT primed by redstone in the wilderness explodes beside a PvP-off town: the
  players inside take no damage (their blocks are already protected).

## Shelves and double chests (`InteractListener`, `BlockListener`, `WorldListener`)

- A shelf in the wilderness beside a row of town shelves: an outsider cannot
  swap items through it, nor place a shelf that joins the town's row.
- A double chest straddling a claim border: an outsider cannot open the wild
  half, and a hopper under the wild half cannot drain it.

## Raids, withers, boats (`MobListener.onRaid`, `WitherListener`, `EntityListener`)

- An outsider with Bad Omen walks into a town's village, or into the wilderness
  within `grief.raidRadiusBlocks` (64) of a town: no raid starts.
- An outsider builds a wither on soul sand within 8 chunks of a town or spawn:
  the last skull is refused. A wither built elsewhere that flies over a town
  breaks nothing there (its builder is an outsider). A wither a dispenser
  completed belongs to nobody and breaks nothing on anyone's land. A skull
  placed on an earlier tick does not make its placer the builder.
- A boat pushed into a town's pen from the wilderness, or ridden by an
  outsider, does not pick up the animals; nor does a boat whose animal an
  outsider holds on a lead, nor a boat an outsider walks into the town on a
  lead. (MockBukkit's boats do not implement `Leashable#isLeashed`, so the
  tests use a pig as the vehicle.)

## Portals (`MovementListener`)

- An outsider walks through a nether portal whose exit is inside a town: the
  trip is refused. The same through an end gateway.

## Lesser holes (`ContactListener`, `FireListener`, `WorldListener`, `MobListener`, `BlockListener`)

- An outsider picks up an item lying in a town, or reels it in with a fishing
  rod: refused. They pick up what they dropped there, and their own drops after
  dying there. (MockBukkit does not implement `Item#getThrower` or
  `Item#setThrower`.)
- An outsider's allay, or a fox or villager from the wilderness, picks up items
  lying in a town: refused. A villager born in the town picks up its bread.
- An outsider walks into a town's cow or boat to push it out of its pen, or
  rides a boat, cart or horse into it: it does not move. A town member pushes
  it.
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

## Arrivals (`ArrivalListener`)

- An outsider respawns at a bed or anchor inside a town (set before they were
  removed): they respawn on the nearest wilderness instead. Logging in inside a
  town is covered by `ReReviewRegressionTest`.

## Known limits

- Vibrations with no entity behind them (a note block, a piston, a dispenser)
  reach a town's sculk sensors from outside: Paper's `BlockReceiveGameEvent`
  gives no source position, so their origin cannot be judged (P2-11).
- P2-5, P2-6 and P2-7 from the re-review of the grief fixes are accepted as
  known limits.
- Untraced explosions from wilderness-spawned creepers do not hurt players in
  PvP-off towns. This over-protection is accepted.
- Walling a town in from the wilderness is allowed by design.
