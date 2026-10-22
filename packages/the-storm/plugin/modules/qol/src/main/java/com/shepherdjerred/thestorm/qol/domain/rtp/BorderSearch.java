package com.shepherdjerred.thestorm.qol.domain.rtp;

/**
 * A world whose settled land reaches its border, so random teleport searches the whole border
 * instead of past the farthest settlement. Settled chunks are still never a landing.
 *
 * @param world the world name
 * @param inner the nearest a landing may be to spawn
 */
public record BorderSearch(String world, int inner) {

  public BorderSearch {
    if (world.isBlank()) {
      throw new IllegalArgumentException("border search world must not be blank");
    }
    if (inner < 0) {
      throw new IllegalArgumentException("border search inner must not be negative: " + inner);
    }
  }
}
