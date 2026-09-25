package com.shepherdjerred.thestorm.npcs.domain.trainer;

/**
 * A track level a trainer offers, as quoted by the tracks module.
 *
 * @param track the track id
 * @param level the level on offer
 * @param cost its price in whole crystals
 */
public record Offer(String track, int level, long cost) {

  public Offer {
    if (level < 1) {
      throw new IllegalArgumentException("offered level must be positive: " + level);
    }
    if (cost < 1) {
      throw new IllegalArgumentException("offered cost must be positive: " + cost);
    }
  }
}
