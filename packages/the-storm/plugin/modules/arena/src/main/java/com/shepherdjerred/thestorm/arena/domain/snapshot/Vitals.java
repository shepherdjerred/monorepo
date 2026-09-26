package com.shepherdjerred.thestorm.arena.domain.snapshot;

/**
 * A player's health, hunger and game mode.
 *
 * @param health current health
 * @param food the hunger bar, 0 to 20
 * @param saturation hidden food saturation
 * @param exhaustion hidden food exhaustion
 * @param gameMode the game mode's name, such as {@code SURVIVAL}
 */
public record Vitals(double health, int food, float saturation, float exhaustion, String gameMode) {

  public Vitals {
    if (!(health >= 0)) {
      throw new IllegalArgumentException("health must not be negative: " + health);
    }
    if (food < 0 || food > 20) {
      throw new IllegalArgumentException("food must be 0-20: " + food);
    }
    if (gameMode.isBlank()) {
      throw new IllegalArgumentException("gameMode must not be blank");
    }
  }
}
