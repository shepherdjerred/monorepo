package com.shepherdjerred.thestorm.arena.domain.wave;

/**
 * One mob to spawn, with its riders, already scaled.
 *
 * @param mob the archetype id
 * @param health multiplier on vanilla max health
 * @param damage multiplier on vanilla attack damage
 * @param entities how many entities it is, riders included, for the arena's entity cap
 */
public record SpawnUnit(String mob, double health, double damage, int entities) {

  public SpawnUnit {
    if (entities < 1) {
      throw new IllegalArgumentException("a unit is at least one entity");
    }
  }
}
