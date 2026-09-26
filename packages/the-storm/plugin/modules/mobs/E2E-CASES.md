# Mobs: real-server cases

Behaviour MockBukkit cannot exercise. The e2e suite (`packages/the-storm/tests/e2e`) should cover these.

1. A naturally spawned zombie 3000 blocks from spawn carries `thestorm:mob_level`, keyed `thestorm:mob_level_*` attribute modifiers and a "Lv N Zombie" name shown only when looked at; its health bar starts full.
2. Levelled mobs still despawn when no player is near (the plugin-set custom name must not make them persistent).
3. A levelled skeleton's arrow and a levelled creeper's blast deal more damage than a level-1 one at the same spot (`RANGED_DAMAGE`, `CREEPER_BLAST`).
4. Killing a levelled mob by hand drops more experience and larger stackable drops; the same mob killed by lava or fall drops vanilla amounts; armor and weapons it wore are never duplicated.
5. With the towns module holding an admin region around the configured anchor, no hostile mob spawns naturally inside it at night; spawner-egg zombies still appear there, unlevelled.
6. An anchor placed in the wilderness is logged once and ignored: monsters keep spawning everywhere.
7. Mobs spawned by the arena (tagged `thestorm:arena` in the spawn consumer), spawners, trial spawners and `/summon` stay vanilla.
8. Nether mobs level by eight times their distance; End mobs never level.
9. A full moon at night adds two levels over the surface band; mobs deep underground gain depth levels.
10. Restarting the server keeps existing mobs' levels and modifiers; `MobLevels.strip` returns one to vanilla stats.
