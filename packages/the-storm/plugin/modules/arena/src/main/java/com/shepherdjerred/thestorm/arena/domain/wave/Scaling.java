package com.shepherdjerred.thestorm.arena.domain.wave;

/**
 * How mobs grow with the wave number and the number of fighters. Every factor is linear: wave 1 and
 * one fighter are the baseline.
 *
 * @param healthPerWave extra mob health per wave after the first (0.03 is +3% a wave)
 * @param damagePerWave extra mob damage per wave after the first
 * @param healthPerExtraPlayer extra mob health per fighter after the first (not for swarms)
 * @param countPerExtraPlayer extra mobs per fighter after the first
 * @param bossHealthPerExtraPlayer extra boss health per fighter after the first
 */
public record Scaling(
    double healthPerWave,
    double damagePerWave,
    double healthPerExtraPlayer,
    double countPerExtraPlayer,
    double bossHealthPerExtraPlayer) {

  public Scaling {
    requireFactor("healthPerWave", healthPerWave);
    requireFactor("damagePerWave", damagePerWave);
    requireFactor("healthPerExtraPlayer", healthPerExtraPlayer);
    requireFactor("countPerExtraPlayer", countPerExtraPlayer);
    requireFactor("bossHealthPerExtraPlayer", bossHealthPerExtraPlayer);
  }

  private static void requireFactor(String name, double value) {
    if (!(value >= 0 && value <= 5)) {
      throw new IllegalArgumentException(name + " must be 0 to 5: " + value);
    }
  }
}
