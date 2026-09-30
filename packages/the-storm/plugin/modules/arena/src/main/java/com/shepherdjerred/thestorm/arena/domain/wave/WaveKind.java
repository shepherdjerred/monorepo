package com.shepherdjerred.thestorm.arena.domain.wave;

/** What kind of wave it is, which decides its announcement and how it scales. */
public enum WaveKind {
  /** Ordinary mobs. */
  STANDARD,
  /** Many weak mobs: more of them per extra player, but no extra health. */
  SWARM,
  /** Mounted mobs: zombie horsemen, camel-husk jockeys. */
  CAVALRY,
  /** A boss with abilities and a health bar, sometimes with adds. */
  BOSS,
  /** A breather after a boss: every fighter's consumables are refilled. */
  UPGRADE,
}
