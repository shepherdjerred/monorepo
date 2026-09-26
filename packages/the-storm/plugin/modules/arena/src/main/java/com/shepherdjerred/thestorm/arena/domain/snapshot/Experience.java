package com.shepherdjerred.thestorm.arena.domain.snapshot;

/**
 * A player's experience, as the three numbers the game keeps.
 *
 * @param level the level shown on the bar
 * @param progress progress towards the next level, 0 to 1
 * @param total total experience points, used for scoring
 */
public record Experience(int level, float progress, int total) {

  public Experience {
    if (level < 0 || total < 0) {
      throw new IllegalArgumentException("experience must not be negative");
    }
    if (!(progress >= 0 && progress <= 1)) {
      throw new IllegalArgumentException("progress must be 0 to 1: " + progress);
    }
  }
}
