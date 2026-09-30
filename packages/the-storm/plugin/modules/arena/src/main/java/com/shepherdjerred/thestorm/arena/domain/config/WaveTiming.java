package com.shepherdjerred.thestorm.arena.domain.config;

import java.time.Duration;

/**
 * The pace of a game.
 *
 * @param firstWave the pause between the gates opening and wave 1
 * @param between the pause between clearing a wave and the next one
 * @param timeout if a wave is not cleared this long after it starts, the next wave comes anyway
 *     (the final wave has no timeout)
 * @param entityCap the most arena mobs alive at once; the rest of a wave waits its turn
 */
public record WaveTiming(Duration firstWave, Duration between, Duration timeout, int entityCap) {

  public WaveTiming {
    if (firstWave.isNegative() || between.isNegative()) {
      throw new IllegalArgumentException("pauses must not be negative");
    }
    if (timeout.compareTo(Duration.ofSeconds(30)) < 0) {
      throw new IllegalArgumentException("timeout must be at least 30 seconds: " + timeout);
    }
    if (entityCap < 1 || entityCap > 300) {
      throw new IllegalArgumentException("entityCap must be 1-300: " + entityCap);
    }
  }
}
