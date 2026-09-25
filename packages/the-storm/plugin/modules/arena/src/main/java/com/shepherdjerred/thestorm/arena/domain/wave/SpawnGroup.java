package com.shepherdjerred.thestorm.arena.domain.wave;

/**
 * Some mobs of one archetype in a wave.
 *
 * @param mob the archetype id, from the mob section of the file
 * @param count how many for one player on the first wave of the range
 * @param growth how many more per wave into the range (fractions accumulate)
 */
public record SpawnGroup(String mob, int count, double growth) {

  public SpawnGroup {
    if (count < 1 || count > 200) {
      throw new IllegalArgumentException("count must be 1-200: " + count);
    }
    if (!(growth >= 0 && growth <= 20)) {
      throw new IllegalArgumentException("growth must be 0-20: " + growth);
    }
  }
}
