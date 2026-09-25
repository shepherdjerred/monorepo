package com.shepherdjerred.thestorm.shards.domain;

/**
 * Who is on the other side of a hit. Bonuses apply in full against mobs and scaled against players.
 */
public enum Opponent {
  /** Another player: bonuses are scaled by the PvP multiplier. */
  PLAYER,
  /** Any mob: bonuses apply in full. */
  MOB,
  /** No attacker (falls, fire, drowning, the void): Storm armor does not help. */
  ENVIRONMENT
}
