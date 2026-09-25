# Mechanics: cases for the real-server e2e harness

Unit and MockBukkit tests cannot cover these: they depend on Paper physics,
events or APIs MockBukkit does not implement. Each belongs in
`packages/the-storm/tests/e2e`.

## Structures (bridges, doors, gates)

- Write both `[Bridge]` signs; right-click either end: the bridge opens and
  closes, and only the first-written sign holds blocks (`/data` on both).
- A wall sign, torch, lever, rail, carpet, item frame or painting on a
  bridge, door or gate block: toggling is refused and nothing pops off.
- Break the sign holding a bridge's blocks while it is open: exactly that
  many blocks drop, in full stacks; the other end then refuses to toggle.
- A second `[Gate]` sign on the far side of the same fence gate links to the
  first; either sign toggles and only the first holds fences.
- Two fence runs stacked in one column close and open repeatedly without the
  gate refusing (the upper run stops one block above the lower top).
- Toggling twice within 20 ticks: the second is refused.
- Redstone from a lever in the wilderness does not open a town's bridge;
  from inside the town it does.
- A structure reaching into an unloaded chunk or past the world border does
  not load the chunk or move blocks there.

## Drops

- Glass without silk touch, broken by a Mechanic I player: one glass block
  drops (`BlockDropItemEvent` fires with an empty drop list).
- A bookshelf drops itself instead of books; with silk touch nothing changes.

## Pistons

- `[Crush]` breaks the block in front and the piston then extends.
- `[Bounce]` launches a hostile mob anywhere, but not a player or a passive
  animal where the sign's creator may not harm them.
- `[SuperPush]` and `[SuperSticky]` move lines of blocks, never a chest, a
  blacklisted block, or anything past the world border or outside the
  creator's land.

## Others

- Hidden switch: right-clicking the wall flips the lever on the far side
  and presses buttons, which release on time.
- Elevator arrivals obey `TELEPORT_INTO`; light switches, cooking pots, the
  sign copier and the painting switcher work as described in `mechanics.yml`.
