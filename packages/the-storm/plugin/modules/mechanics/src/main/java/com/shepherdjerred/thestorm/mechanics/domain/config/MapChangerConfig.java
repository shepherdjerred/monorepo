package com.shepherdjerred.thestorm.mechanics.domain.config;

/**
 * Map changers: a {@code [Map]} sign that cycles the maps shown in item frames next to it.
 *
 * @param access who may build and use them
 * @param maxRange the most map ids one sign cycles through
 */
public record MapChangerConfig(Access access, int maxRange) {

  public static final int MAX_RANGE = 256;

  public MapChangerConfig {
    Checks.range("maxRange", maxRange, 2, MAX_RANGE);
  }
}
