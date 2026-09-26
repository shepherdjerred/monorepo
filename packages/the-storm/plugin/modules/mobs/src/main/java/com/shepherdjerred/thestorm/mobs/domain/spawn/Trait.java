package com.shepherdjerred.thestorm.mobs.domain.spawn;

/** What the adapter observed about a spawning mob. */
public enum Trait {
  /** A monster: zombies, skeletons, creepers, slimes, ghasts and the like. */
  HOSTILE,
  /** A boss: the Ender Dragon or the Wither. */
  BOSS,
  /** Already has a custom name. */
  NAMED,
  /** Tamed by a player. */
  TAMED,
  /** A baby. */
  BABY,
  /** Spawned by the arena, which tags its mobs {@code thestorm:arena_entity}. */
  ARENA,
  /** Inside an admin region such as the spawn town. */
  ADMIN_REGION
}
