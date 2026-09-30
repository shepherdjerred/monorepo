package com.shepherdjerred.thestorm.mobs.domain.spawn;

/** What happens to hostile mobs spawning inside admin regions such as the spawn town. */
public enum AdminPolicy {
  /**
   * Natural spawns (the dark, jockeys, patrols, reinforcements) are stopped; others, such as from
   * spawners or eggs, are left unlevelled.
   */
  BLOCK_NATURAL,
  /** Every hostile mob spawns but none is levelled. */
  UNLEVELLED,
  /** Admin regions are treated like anywhere else. */
  LEVELLED
}
