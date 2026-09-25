# Arena: cases for the real-server e2e harness

Unit, repository and MockBukkit tests cover the game state machine, wave table
resolution and scaling, boss ability timing and targeting, rewards and caps,
snapshot bookkeeping and the restore order, storage, and on MockBukkit: join,
leave, disconnect and crash restores; emptying a joining player in the same
tick (drops, pickups and teleports refused while joining); a failed snapshot
write putting the player back; kit tagging; members kept away from containers,
entities and outside blocks; outsiders kept out of a running arena and its
chests; arena items swept from anyone else; transforms refused; offspring
adopted; a refused spawn stopping the game; the cursor item kept in the
snapshot; and vault loot claimed before it is handed out.

MockBukkit cannot run live arena mobs or save player data (no
`setRemoveWhenFarAway`, pathfinder, lightning, chunk tickets, `saveData`,
`scale` or attack-damage attributes on its zombie, or `getTargetBlockExact`),
and it does not fire vanilla behavior (splits, reinforcements, conversions,
crafting grids) on its own. These cases need the real server in
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
8. Piglin brutes (waves 49-69) and the Warlord stay piglins in the Overworld
   for the whole wave; husks in water, zombies drowning and skeletons in powder
   snow never convert.
9. Offspring join the wave: magma cubes (wave 65) split into tagged pieces
   that must die before the wave clears; the Hexmaster's and wave-52 evokers'
   vexes and zombie reinforcements are tagged, counted and kept inside.
10. With the towns protection (or any plugin) cancelling `CUSTOM` spawns in
    the region, the first wave stops the game, restores everyone and logs an
    error naming the arena, instead of a wave that clears with no mobs.

## Custom AI

11. Explosive sheep (wave 5) run at the nearest fighter and explode without
    breaking blocks.
12. Sulfur cubes (wave 55) hunt and ignite near a fighter. Confirm what
    `SulfurCube#ignite` does in 26.2; if it does not explode, the archetype
    needs an explosion path like the sheep.
13. Rainbow sheep (wave 65) follow fighters and never attack.

## Bosses

14. Each boss spawns named, with a boss bar that every member (spectators
    included) sees and that tracks its health; the bar disappears on death or
    reset, and "is defeated" is announced.
15. Lightning Aura, Chain Lightning, Disorient, Knockback Slam and Shield Break
    hit only fighters in range, on their cooldowns; Disorient turns the
    fighter around; Shield Break puts the shield on cooldown; Summon Adds
    respects the entity cap.
16. Heartwood (wave 40): a creaking heart grows on a mob spawn, the boss takes
    no damage, five hits break the heart and cost a quarter of the boss's
    health, the heart moves, and the block is restored when the fight ends.
    The towns protection must not cancel the `BlockDamageEvent` on the heart.
17. The Warden finale (wave 72) is beatable solo with a Tank kit on Ominous I.

## Players

18. Dying mid-wave: no drops, respawn at the exit, belongings and location
    restored, "fell on wave N" announced, best wave recorded.
19. Quitting while dead, then rejoining still dead: nothing is restored until
    they respawn, then everything is.
20. Disconnecting mid-wave: restored before the server saves the player; the
    game goes on for the others, or ends in defeat if nobody is left.
21. `kill -9` the server mid-game, restart, rejoin: belongings restored, no
    arena items anywhere (inventory or ender chest), no arena mobs left, loot
    chests empty, no creaking heart on a mob spawn.
22. `kill -9` the server right after `/arena leave` (once the chat says the
    player left): on restart the player has their belongings (the restore
    saved their data before deleting the snapshot) and is not restored a
    second time.
23. Items in the 2x2 crafting grid and on the cursor when joining come back
    on leaving; an arena item on the cursor when leaving is gone.
24. Ender pearls, chorus fruit, `/home`, `/spawn`, `/back` and `/tpa` cannot
    take a member out of the region, nor bring anyone else into it while a
    game runs; walking in sends an outsider to the exit and walking out sends
    a member back.
25. Members cannot drop items, open non-loot containers, the ender chest, a
    donkey's or llama's chest, a minecart chest, or put items into item
    frames or armor stands; they break or place no blocks and pour no fluids
    anywhere, including blocks just outside the region; an Oddjob's placed
    TNT is lit instead, and fighters take no damage from each other's TNT or
    arrows. Outsiders cannot open the loot chests while a game runs.
26. A player who ends up holding an arena item outside (by any route) loses it
    on their next inventory open, click, close or pickup, and so does any
    container they open.
27. Chunk tickets exist only while a game runs, and are shared with other
    modules holding the same chunks.

## Rewards

28. Clearing boss waves 30-72 on Ominous I pays 125 crystals each through the
    economy with reasons `arena:colosseum:waveN`, and 750 in total; the same
    clear on Ominous V pays 250 each, 1,500 in total.
29. Clearing wave 10 opens its vault once per player per day (the day turns
    over at midnight America/Los_Angeles); the loot is handed over after
    leaving the arena (overflow drops at their feet), and a second clear that
    day says the vault is already open. Loot claimed while the player is dead
    or back in an arena is put back and handed over later.
30. `/arena top colosseum` lists the best waves after games end.

## Commands and signs

31. `/arena here` prints the player's spot, block and targeted block as YAML
    and copies on click.
32. Class signs, the ready block and the join sign work by right-click; an
    advanced class sign refuses players without
    `thestorm.arena.class.<id>`; Wolfmasters can still sit and feed their
    own wolves.
33. Bedrock (Geyser): boss bars, class signs and messages render.

## Balance (manual acceptance)

34. One player clears waves 1-72 solo on Ominous I with each open class, and
    two or three players find the same waves only moderately harder.
