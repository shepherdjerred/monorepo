package com.shepherdjerred.thestorm.arena.domain.wave;

import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Pattern;

/**
 * {@code arena/waves.yml} as written. {@link WaveTable#of} checks that it is complete and
 * consistent.
 *
 * @param finalWave the last wave; clearing it wins the game
 * @param mobs archetype id to archetype
 * @param bosses boss id to boss
 * @param waves the rows of the table, which together must cover waves 1 to {@code finalWave} once
 */
public record WaveFile(
    int finalWave,
    Map<String, MobArchetype> mobs,
    Map<String, BossDefinition> bosses,
    List<WaveEntry> waves) {

  private static final Pattern ID = Pattern.compile("[a-z][a-z0-9-]*");

  public WaveFile {
    if (finalWave < 1 || finalWave > 1000) {
      throw new IllegalArgumentException("finalWave must be 1 to 1000: " + finalWave);
    }
    requireIds("mob", mobs.keySet());
    requireIds("boss", bosses.keySet());
    mobs = Map.copyOf(new TreeMap<>(mobs));
    bosses = Map.copyOf(new TreeMap<>(bosses));
    waves = List.copyOf(waves);
  }

  private static void requireIds(String what, Iterable<String> ids) {
    for (var id : ids) {
      if (!ID.matcher(id).matches()) {
        throw new IllegalArgumentException(what + " id must be lower-case kebab-case: " + id);
      }
    }
  }
}
