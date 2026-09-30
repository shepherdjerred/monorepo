package com.shepherdjerred.thestorm.world.domain;

import java.time.ZoneId;

/** Main-world spawn arrival barks, independent of the on-demand crier command. */
public record AmbientConfig(
    boolean enabled,
    String world,
    int spawnX,
    int spawnY,
    int spawnZ,
    int spawnRadius,
    int verticalRadius,
    String timeZone) {

  public AmbientConfig {
    if (!"world".equals(world)) {
      throw new IllegalArgumentException("ambient barks are restricted to the main world");
    }
    if (spawnRadius < 1 || spawnRadius > 64 || verticalRadius < 1 || verticalRadius > 32) {
      throw new IllegalArgumentException("invalid ambient spawn radius");
    }
    ZoneId.of(timeZone);
  }

  public ZoneId zone() {
    return ZoneId.of(timeZone);
  }
}
