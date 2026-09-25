# Arena: cases for the real-server e2e harness

Unit, repository and MockBukkit tests cover the game state machine, wave table
resolution and scaling, boss ability timing and targeting, rewards and caps,
snapshot bookkeeping, storage, and join/leave/disconnect/crash restores with
kit tagging. MockBukkit cannot run live arena mobs (no `setRemoveWhenFarAway`,
pathfinder, lightning, chunk tickets, `scale` or attack-damage attributes on
its zombie, or `getTargetBlockExact`), so these cases need the real server in
`packages/the-storm/tests/e2e`. Each is a pass/fail check.

## Waves and mobs

1. Force-start the colosseum with one knight; advance through wave 1. Mobs
   spawn at the mob spawns, carry the `thestorm:arena_entity` tag, never
   despawn, and do not burn in daylight.
2. The colossus (wave 70) is a zombie at scale 4 that still pathfinds and
   attacks; a cavalry wave spawns zombie horsemen and camel-husk jockeys with
   their riders mounted and holding spears.
3. Mob max health and attack damage match `WaveScaling` for 1, 2 and 3
   fighters on Ominous I and V (read the attributes back).
4. With `entityCap: 40`, a wave for four fighters never has more than 40 arena
   entities alive; the rest spawn as mobs die.
5. A mob pushed or pearled out of the region is back at a mob spawn within a
   second; a mount teleported back keeps its rider.
6. A wave whose last mob is stuck in a wall moves on after `timeout`; the final
   wave never times out.
7. Killed arena mobs drop nothing and give no experience.

## Custom AI

8. Explosive sheep (wave 5) run at the nearest fighter and explode without
   breaking blocks.
9. Sulfur cubes (wave 55) hunt and ignite near a fighter. Confirm what
   `SulfurCube#ignite` does in 26.2; if it does not explode, the archetype
   needs an explosion path like the sheep.
10. Rainbow sheep (wave 65) follow fighters and never attack.

## Bosses

11. Each boss spawns named, with a boss bar that every member (spectators
    included) sees and that tracks its health; the bar disappears on death or
    reset, and "is defeated" is announced.
12. Lightning Aura, Chain Lightning, Disorient, Knockback Slam and Shield Break
    hit only fighters in range, on their cooldowns; Disorient turns the
    fighter around; Shield Break puts the shield on cooldown; Summon Adds
    respects the entity cap.
13. Heartwood (wave 40): a creaking heart grows on a mob spawn, the boss takes
    no damage, five hits break the heart and cost a quarter of the boss's
    health, the heart moves, and the block is restored when the fight ends.
    The towns protection must not cancel the `BlockDamageEvent` on the heart.
14. The Warden finale (wave 72) is beatable solo with a Tank kit on Ominous I.

## Players

15. Dying mid-wave: no drops, respawn at the exit, belongings and location
    restored, "fell on wave N" announced, best wave recorded.
16. Quitting while dead, then rejoining: restored on join.
17. Disconnecting mid-wave: restored before the server saves the player; the
    game goes on for the others, or ends in defeat if nobody is left.
18. `kill -9` the server mid-game, restart, rejoin: belongings restored, no
    arena items anywhere (inventory or ender chest), no arena mobs left, loot
    chests empty, no creaking heart on a mob spawn.
19. Ender pearls, chorus fruit, `/home`, `/spawn` and `/tpa` cannot take a
    member out of the region; walking out teleports them back.
20. Players cannot drop items, open non-loot containers or the ender chest,
    or break or place blocks in the arena; an Oddjob's placed TNT is lit
    instead, and fighters take no damage from each other's TNT or arrows.
21. Chunk tickets exist only while a game runs.

## Rewards

22. Clearing boss waves 30-72 on Ominous I pays 125 crystals each through the
    economy with reasons `arena:colosseum:waveN`, and never more than 750 in
    one game (Ominous V reaches the cap by wave 50).
23. Clearing wave 10 opens its vault once per player per UTC day; the loot is
    handed over after leaving the arena (overflow drops at their feet), and a
    second clear that day says the vault is already open.
24. `/arena top colosseum` lists the best waves after games end.

## Commands and signs

25. `/arena here` prints the player's spot, block and targeted block as YAML
    and copies on click.
26. Class signs, the ready block and the join sign work by right-click; an
    advanced class sign refuses players without
    `thestorm.arena.class.<id>`.
27. Bedrock (Geyser): boss bars, class signs and messages render.

## Balance (manual acceptance)

28. One player clears waves 1-72 solo on Ominous I with each open class, and
    two or three players find the same waves only moderately harder.
