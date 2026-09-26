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
- A double chest straddling a claim border: a hopper under the wild half
  cannot drain it. (Anyone may open an unlocked chest, in a town or not; a
  locked one opens only for its owner's people.)

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
  rod: refused unless the claim has `public-entities` on. They pick up what
  they dropped there, and their own drops after dying there. (MockBukkit does
  not implement `Item#getThrower` or `Item#setThrower`.)
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

## Locks (`LockCommands`, `LockListener`)

MockBukkit does not implement `LivingEntity#getTargetBlockExact`, `Entity#getOrigin`
or real chest joining, so `LockListenersTest` seeds locks in storage and calls
the events itself. These need a real server:

- `/lock` while looking at each lockable type (chest, trapped chest, barrel,
  every shulker box colour, every copper chest, furnace, blast furnace, smoker,
  brewing stand, hopper, dropper, dispenser, crafter, every wooden shelf):
  locked; `/lock info` names the owner; `/unlock` frees it. Looking at a
  non-container says what can be locked.
- A double chest: `/lock` on either half locks both (`/lock info` says "both
  halves"). The owner places a chest beside their locked chest: the new half
  is locked with it. A stranger cannot place a chest, hopper, dropper or other
  container against a locked one, and cannot open the unlocked half of a double
  chest whose other half is locked.
- Only the placer locks a container they placed; someone else trying gets
  "Someone else placed that". An outsider cannot lock an unrecorded chest in a
  town (not their land); in the wilderness anyone may lock one nobody is
  recorded as placing.
- A new container is locked for its placer. `/unlock` makes it public. Once a
  player reaches 64 locks, placing another container is refused until they
  unlock one. A player cannot join their chest to someone else's unlocked
  chest and take ownership through automatic locking. While locks are saving,
  placement waits; if the new lock cannot be saved, the placed container is
  broken back into an item instead of being left public.
- `/lock trust Bob`: Bob opens it but cannot break it; `/lock trust Bob manage`
  allows both; `/lock untrust Bob` removes access. `/lock share on` lets town
  mates open it, never break it; sharing starts off for new locks.
- `/lock redstone on` permits wiring a locked dispenser, dropper or crafter;
  redstone starts blocked for new locks. `/lock info` shows grants and options.
- A hopper under a locked chest that the owner did not lock drains nothing;
  once the owner locks the hopper too, it drains. A hopper minecart under a
  locked chest takes nothing. A dropper or crafter pushing into a locked chest
  moves nothing unless the owner locked it too.
- A copper golem never takes from or fills a locked chest
  (`ItemTransportingEntityValidateTargetEvent`).
- Allays never open containers in vanilla, so they need no rule.
- TNT, a creeper and a wither skull beside a locked chest: the chest survives
  (the blast is `EntityExplodeEvent`, which needs `Entity#getOrigin`). A piston
  pushing a locked shulker box does not destroy it. Fire next to a locked
  barrel or shelf does not burn it. A wither or enderman never breaks or takes
  a locked block (`EntityChangeBlockEvent`).
- A stranger's button or lever within two blocks of a locked dispenser,
  dropper or crafter is refused, so they cannot make it spit out its items.
- Staff with `thestorm.towns.bypass` open locked containers and `/unlock` any
  lock.

## Towns part 2 (`MemberCommands`, `TreasuryCommands`, `PvpCommands`, `JoinListener`)

- An owner's Governor level is recorded when they join and leave; with the
  owner offline, `/town info` still shows the limit from their last level.
  Right after joining, the tracks port reads 0 until progress loads; the town
  keeps the level from the owner's track permissions (LuckPerms), so the limit
  never drops for that moment.
- A player invited while offline hears about it when they next join
  (invitations are memory only; a restart withdraws them).
- `/pvp off` then a spell or arrow from another player: no harm, through the
  `Protection.checkHarm(PLAYER)` port too (the port finds the victim as the
  player standing where the harm lands).
- After successful player damage, neither attacker nor victim can change their
  PvP switch for 30 seconds. Cancelled or zero-damage hits do not count.
- `/town delete <name>` with crystals in the treasury: the owner's balance
  grows by the treasury in one ledger entry (`town:delete:<id>`).

## BlueMap (`adapter.bluemap`)

- With BlueMap installed, each town's land shows as teal areas in a "Towns"
  marker set, one per connected piece, with unclaimed pockets as holes. Claim,
  unclaim, rename and delete update it at once; `/bluemap reload` redraws
  every town. Without BlueMap the module starts normally (every MockBukkit test
  runs without it).

## Arena region (`SpawnListener`, `BlockListener`)

- Natural spawns never appear inside the arena; the arena module's waves
  (`CUSTOM`), evoker vexes, zombie reinforcements, split slimes, jockeys,
  mounts and `/summon` do. A creaking heart the arena places spawns its
  creaking only if that spawn's reason is on the list; if the arena relies on
  vanilla heart spawns, add that reason in `towns.yml`.
- Players break the creaking heart inside the arena; every other block there
  stays unbreakable.

## Known limits

- Vibrations with no entity behind them (a note block, a piston, a dispenser)
  reach a town's sculk sensors from outside: Paper's `BlockReceiveGameEvent`
  gives no source position, so their origin cannot be judged (P2-11).
- P2-5, P2-6 and P2-7 from the re-review of the grief fixes are accepted as
  known limits.
- Untraced explosions from wilderness-spawned creepers do not hurt players in
  PvP-off towns. This over-protection is accepted.
- Walling a town in from the wilderness is allowed by design.
