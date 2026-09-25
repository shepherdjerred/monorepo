package com.shepherdjerred.thestorm.arena.domain.wave;

import java.util.List;
import java.util.Optional;

/**
 * A wave ready to spawn: its mobs scaled for the fighters left and the arena's tier.
 *
 * @param number the wave number, from 1
 * @param kind what kind of wave it is
 * @param units the mobs, one entry per mob, in spawn order
 * @param boss the boss, spawned before the mobs
 */
public record ResolvedWave(
    int number, WaveKind kind, List<SpawnUnit> units, Optional<BossOrder> boss) {

  public ResolvedWave {
    units = List.copyOf(units);
  }
}
