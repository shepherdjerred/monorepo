package com.shepherdjerred.thestorm.arena.domain.wave;

import java.util.List;
import java.util.Optional;

/**
 * One row of the wave table: the waves {@code from} to {@code to} (inclusive) and what they bring.
 *
 * @param from the first wave of the range
 * @param to the last wave of the range
 * @param kind what kind of waves these are
 * @param spawns the mobs; may be empty only for upgrade and boss waves
 * @param boss the boss id, required for boss waves and absent otherwise
 */
public record WaveEntry(
    int from, int to, WaveKind kind, List<SpawnGroup> spawns, Optional<String> boss) {

  public WaveEntry {
    if (from < 1 || to < from) {
      throw new IllegalArgumentException("need 1 <= from <= to: " + from + "-" + to);
    }
    if ((kind == WaveKind.BOSS) != boss.isPresent()) {
      throw new IllegalArgumentException("boss waves name a boss; other waves must not");
    }
    var needsSpawns = kind != WaveKind.BOSS && kind != WaveKind.UPGRADE;
    if (needsSpawns && spawns.isEmpty()) {
      throw new IllegalArgumentException(kind + " waves need at least one spawn");
    }
    spawns = List.copyOf(spawns);
  }

  public boolean covers(int wave) {
    return wave >= from && wave <= to;
  }
}
