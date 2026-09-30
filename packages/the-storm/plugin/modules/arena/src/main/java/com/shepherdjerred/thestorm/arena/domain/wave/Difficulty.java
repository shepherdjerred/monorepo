package com.shepherdjerred.thestorm.arena.domain.wave;

/**
 * What a wave scales against: how many fighters are left, the arena's tier and the scaling rules.
 *
 * @param players fighters still alive when the wave starts, at least 1
 * @param tier the arena's difficulty tier
 * @param scaling the growth rules
 */
public record Difficulty(int players, Tier tier, Scaling scaling) {

  public Difficulty {
    if (players < 1) {
      throw new IllegalArgumentException("a wave needs at least one player: " + players);
    }
  }

  /** Fighters beyond the first. */
  int extraPlayers() {
    return players - 1;
  }
}
