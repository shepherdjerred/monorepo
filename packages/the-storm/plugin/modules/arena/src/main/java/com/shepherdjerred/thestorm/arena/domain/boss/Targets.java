package com.shepherdjerred.thestorm.arena.domain.boss;

import static java.util.Comparator.comparingDouble;

import com.shepherdjerred.thestorm.arena.domain.geometry.Point;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** Who a boss ability hits, chosen from the fighters' positions. Ties go to the lower id. */
public final class Targets {

  private Targets() {}

  /** Fighters within {@code radius} of {@code origin}, nearest first. */
  public static List<UUID> within(Point origin, Map<UUID, Point> fighters, double radius) {
    return fighters.entrySet().stream()
        .filter(fighter -> fighter.getValue().distance(origin) <= radius)
        .sorted(byDistanceFrom(origin))
        .map(Map.Entry::getKey)
        .toList();
  }

  /** The fighter nearest {@code origin} within {@code radius}, if any. */
  public static Optional<UUID> nearest(Point origin, Map<UUID, Point> fighters, double radius) {
    return within(origin, fighters, radius).stream().findFirst();
  }

  /**
   * Chain lightning: the nearest fighter within {@code radius} of {@code origin}, then up to {@code
   * jumps} more, each the nearest not yet hit within {@code radius} of the last one hit.
   */
  public static List<UUID> chain(
      Point origin, Map<UUID, Point> fighters, double radius, int jumps) {
    var remaining = new HashMap<>(fighters);
    var hit = new ArrayList<UUID>();
    var from = origin;
    for (var i = 0; i <= jumps; i++) {
      var next = nearest(from, remaining, radius);
      if (next.isEmpty()) {
        break;
      }
      var id = next.orElseThrow();
      hit.add(id);
      var at = remaining.remove(id);
      if (at == null) {
        throw new IllegalStateException("a chosen fighter must still be a candidate");
      }
      from = at;
    }
    return List.copyOf(hit);
  }

  private static Comparator<Map.Entry<UUID, Point>> byDistanceFrom(Point origin) {
    return comparingDouble((Map.Entry<UUID, Point> fighter) -> fighter.getValue().distance(origin))
        .thenComparing(Map.Entry::getKey);
  }
}
