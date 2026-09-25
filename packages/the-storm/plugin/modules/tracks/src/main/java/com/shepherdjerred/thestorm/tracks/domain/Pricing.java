package com.shepherdjerred.thestorm.tracks.domain;

import com.shepherdjerred.thestorm.tracks.app.Track;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;

/**
 * Track level prices: {@code baseCosts[level - 1] × orderMultipliers[position]}, rounded half up to
 * whole crystals, where {@code position} is the track's place in the order the player first bought
 * tracks (0 for the primary).
 *
 * @param baseCosts the price of levels I to V before the multiplier, one per level
 * @param orderMultipliers the multiplier for the first to fifth track a player buys, each at least
 *     1
 */
public record Pricing(List<Long> baseCosts, List<BigDecimal> orderMultipliers) {

  public Pricing {
    baseCosts = List.copyOf(baseCosts);
    orderMultipliers = List.copyOf(orderMultipliers);
    if (baseCosts.size() != Track.MAX_LEVEL) {
      throw new IllegalArgumentException(
          "baseCosts needs one cost per level (" + Track.MAX_LEVEL + "): " + baseCosts);
    }
    if (baseCosts.stream().anyMatch(cost -> cost < 1)) {
      throw new IllegalArgumentException("baseCosts must be at least 1: " + baseCosts);
    }
    var tracks = Track.values().length;
    if (orderMultipliers.size() != tracks) {
      throw new IllegalArgumentException(
          "orderMultipliers needs one multiplier per track (" + tracks + "): " + orderMultipliers);
    }
    if (orderMultipliers.stream()
        .anyMatch(multiplier -> multiplier.compareTo(BigDecimal.ONE) < 0)) {
      throw new IllegalArgumentException(
          "orderMultipliers must be at least 1: " + orderMultipliers);
    }
  }

  /** The price of {@code level} for a track at {@code position} in the player's purchase order. */
  public long cost(int level, int position) {
    if (level < 1 || level > Track.MAX_LEVEL) {
      throw new IllegalArgumentException("level must be 1.." + Track.MAX_LEVEL + ": " + level);
    }
    if (position < 0 || position >= orderMultipliers.size()) {
      throw new IllegalArgumentException("no multiplier for position " + position);
    }
    return BigDecimal.valueOf(baseCosts.get(level - 1))
        .multiply(orderMultipliers.get(position))
        .setScale(0, RoundingMode.HALF_UP)
        .longValueExact();
  }
}
