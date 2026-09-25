package com.shepherdjerred.thestorm.spells.domain.geometry;

import java.util.ArrayList;
import java.util.List;
import java.util.random.RandomGenerator;

/** Confusion: every confused monster turns on another one, never itself. */
public final class Pairing {

  private Pairing() {}

  /**
   * An attacker and the creature it now hunts.
   *
   * @param attacker the confused monster
   * @param target the monster it attacks
   */
  public record Pair<T>(T attacker, T target) {}

  /** A random other target for each of {@code creatures}; nothing when fewer than two. */
  public static <T> List<Pair<T>> turnOnEachOther(List<T> creatures, RandomGenerator random) {
    var pairs = new ArrayList<Pair<T>>();
    if (creatures.size() < 2) {
      return pairs;
    }
    for (var index = 0; index < creatures.size(); index++) {
      // Pick among the others: draw from size-1 slots and skip over the attacker's own slot.
      var pick = random.nextInt(creatures.size() - 1);
      var targetIndex = pick >= index ? pick + 1 : pick;
      pairs.add(new Pair<>(creatures.get(index), creatures.get(targetIndex)));
    }
    return pairs;
  }
}
