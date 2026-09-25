package com.shepherdjerred.thestorm.spells.domain.geometry;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Chain Lightning's path: it strikes the first target, then jumps to the nearest creature not yet
 * struck within jump range of the last one, until it runs out of targets or jumps.
 */
public final class Chain {

  private Chain() {}

  /**
   * Something the chain may strike.
   *
   * @param target what to strike
   * @param position where it is
   */
  public record Link<T>(T target, Vec3 position) {}

  /**
   * The targets in strike order, starting with {@code first}. {@code candidates} are the creatures
   * the chain may jump to; equal distances go to the earlier candidate.
   */
  public static <T> List<T> path(
      Link<T> first, List<Link<T>> candidates, double jumpRange, int maxTargets) {
    if (maxTargets < 1) {
      throw new IllegalArgumentException("a chain strikes at least one target: " + maxTargets);
    }
    var remaining = new ArrayList<>(candidates);
    remaining.removeIf(link -> link.target().equals(first.target()));
    var struck = new ArrayList<T>();
    struck.add(first.target());
    var last = first;
    while (struck.size() < maxTargets) {
      var next = nearestWithin(last.position(), remaining, jumpRange);
      if (next.isEmpty()) {
        break;
      }
      last = next.get();
      remaining.remove(last);
      struck.add(last.target());
    }
    return struck;
  }

  private static <T> Optional<Link<T>> nearestWithin(
      Vec3 from, List<Link<T>> candidates, double range) {
    Optional<Link<T>> best = Optional.empty();
    var bestDistance = range;
    for (var candidate : candidates) {
      var distance = candidate.position().distance(from);
      if (distance <= bestDistance
          && (best.isEmpty() || distance < best.get().position().distance(from))) {
        best = Optional.of(candidate);
        bestDistance = distance;
      }
    }
    return best;
  }

  /** The damage the {@code index}th strike (0-based) deals: each jump multiplies by falloff. */
  public static double damageAt(double damage, double falloff, int index) {
    return damage * Math.pow(falloff, index);
  }
}
