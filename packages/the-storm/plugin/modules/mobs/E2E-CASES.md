# Mobs: real-server cases

Behaviour MockBukkit cannot exercise (it has no loot tables, fires no damage events for mob hits, and never converts mobs). The e2e suite (`packages/the-storm/tests/e2e`) should cover these.

1. A naturally spawned zombie 3000 blocks from spawn carries `thestorm:mob_level`, keyed `thestorm:mob_level_*` attribute modifiers and a "Lv N Zombie" name shown only when looked at; its health bar starts full.
2. Levelled mobs still despawn when no player is near (the plugin-set custom name must not make them persistent).
3. A levelled skeleton's arrow and a levelled creeper's blast deal more damage than a level-1 one at the same spot (`RANGED_DAMAGE`, `CREEPER_BLAST`).
4. Killing a levelled zombie by hand drops more experience and sometimes an extra roll of its loot table. A levelled zombie that picked up 32 diamonds (or a piglin holding gold) drops exactly what it held, never more.
5. A levelled mob killed in a kill chamber, by fall damage, lava, a player's wolf, or mostly by any of those with a player's last hit, drops vanilla experience and loot.
6. Mobs from spawners, trial spawners, eggs, raids, slime splits, portals, reinforcements, lightning, `/summon` and the arena (tagged `thestorm:arena_entity` in the spawn consumer) stay vanilla.
7. With the towns module holding an admin region around the configured anchor, no hostile mob spawns naturally inside it at night; spawner-egg zombies still appear there, unlevelled. An anchor placed in the wilderness is logged once and ignored.
8. A levelled zombie that drowns becomes a drowned of the same level named "Lv N Drowned"; a levelled skeleton freezing into a stray likewise; a levelled slime's children are vanilla.
9. Nether mobs level by four times their distance; End mobs never level.
10. A full moon at night adds two levels over the surface band; mobs deep underground gain depth levels.
11. Restarting the server keeps existing mobs' levels, modifiers and damage ledgers; `MobLevels.strip` returns one to vanilla stats.
