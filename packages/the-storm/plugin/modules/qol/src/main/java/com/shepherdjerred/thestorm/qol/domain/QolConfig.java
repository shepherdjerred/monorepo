package com.shepherdjerred.thestorm.qol.domain;

import com.shepherdjerred.thestorm.qol.domain.rtp.BorderSearch;
import java.time.DateTimeException;
import java.time.Duration;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * {@code plugins/TheStorm/rtp.yml}. Durations are ISO-8601 text because the config parser has no
 * time module.
 */
public record QolConfig(
    String searchInterval,
    String landingMemory,
    int batchSize,
    int minGap,
    int band,
    int borderMargin,
    int nearBestHundredths,
    List<String> biomes,
    List<BorderSearch> withinBorder) {

  private static final Pattern BIOME = Pattern.compile("[a-z0-9_]+");

  public QolConfig {
    biomes = List.copyOf(biomes);
    withinBorder = List.copyOf(withinBorder);
    searchInterval = positive(searchInterval, "searchInterval");
    landingMemory = positive(landingMemory, "landingMemory");
    if (batchSize < 1 || batchSize > 64) {
      throw new IllegalArgumentException("batchSize must be 1-64: " + batchSize);
    }
    if (minGap < 0 || band <= 0 || borderMargin < 0) {
      throw new IllegalArgumentException("search bounds must be positive");
    }
    if (nearBestHundredths < 1 || nearBestHundredths > 100) {
      throw new IllegalArgumentException("nearBestHundredths must be 1-100");
    }
    var seen = new HashSet<String>();
    for (var biome : biomes) {
      if (!BIOME.matcher(biome).matches() || !seen.add(biome)) {
        throw new IllegalArgumentException("bad biome: " + biome);
      }
    }
    if (biomes.isEmpty()) {
      throw new IllegalArgumentException("biomes must not be empty");
    }
    var searched = new HashSet<String>();
    for (var search : withinBorder) {
      if (!searched.add(search.world())) {
        throw new IllegalArgumentException("border search world listed twice: " + search.world());
      }
    }
  }

  /** How {@code world} is searched across its whole border, when it is. */
  public Optional<BorderSearch> withinBorder(String world) {
    return withinBorder.stream().filter(search -> search.world().equals(world)).findFirst();
  }

  public Duration searchIntervalDuration() {
    return Duration.parse(searchInterval);
  }

  public Duration landingMemoryDuration() {
    return Duration.parse(landingMemory);
  }

  public boolean biome(String id) {
    return biomes.contains(id);
  }

  private static String positive(String raw, String name) {
    var duration = nonNegative(raw, name);
    if (Duration.parse(duration).isZero()) {
      throw new IllegalArgumentException(name + " must be positive");
    }
    return duration;
  }

  private static String nonNegative(String raw, String name) {
    try {
      if (Duration.parse(raw).isNegative()) {
        throw new IllegalArgumentException(name + " must not be negative");
      }
    } catch (DateTimeException e) {
      throw new IllegalArgumentException(name + " is not a duration: " + raw, e);
    }
    return raw;
  }
}
