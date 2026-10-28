package com.shepherdjerred.thestorm.skylands.domain;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.jspecify.annotations.Nullable;

/** Exact Manhattan-nearest sockets and per-column levels, indexed once for each route search. */
final class SkyGoals {
  private record Node(SkyPosition point, int axis, @Nullable Node left, @Nullable Node right) {}

  private final Set<SkyPosition> points;
  private final Map<Long, List<Integer>> levels = new HashMap<>();
  private final Node root;

  SkyGoals(Set<SkyPosition> points) {
    this.points = Set.copyOf(points);
    root = java.util.Objects.requireNonNull(tree(new ArrayList<>(points), 0));
    for (var p : points)
      levels
          .computeIfAbsent(LayeredLandscape.columnKey(p.x(), p.z()), ignored -> new ArrayList<>())
          .add(p.y());
  }

  boolean contains(SkyPosition p) {
    return points.contains(p);
  }

  boolean compatible(SkyPosition p) {
    return levels.getOrDefault(LayeredLandscape.columnKey(p.x(), p.z()), List.of()).stream()
        .noneMatch(y -> Math.abs(y - p.y()) > 0 && Math.abs(y - p.y()) < 4);
  }

  int distance(SkyPosition p) {
    return nearest(root, p, Integer.MAX_VALUE);
  }

  private static @Nullable Node tree(List<SkyPosition> points, int depth) {
    if (points.isEmpty()) return null;
    var axis = depth % 3;
    points.sort(Comparator.comparingInt(p -> coordinate(p, axis)));
    var middle = points.size() / 2;
    return new Node(
        points.get(middle),
        axis,
        tree(new ArrayList<>(points.subList(0, middle)), depth + 1),
        tree(new ArrayList<>(points.subList(middle + 1, points.size())), depth + 1));
  }

  private static int nearest(@Nullable Node node, SkyPosition p, int best) {
    if (node == null) return best;
    var q = node.point();
    var distance = Math.abs(q.x() - p.x()) + Math.abs(q.y() - p.y()) + Math.abs(q.z() - p.z());
    var result = Math.min(best, distance);
    var delta = coordinate(p, node.axis()) - coordinate(q, node.axis());
    result = nearest(delta < 0 ? node.left() : node.right(), p, result);
    if (Math.abs(delta) < result)
      result = nearest(delta < 0 ? node.right() : node.left(), p, result);
    return result;
  }

  private static int coordinate(SkyPosition p, int axis) {
    return switch (axis) {
      case 0 -> p.x();
      case 1 -> p.y();
      case 2 -> p.z();
      default -> throw new IllegalArgumentException("Invalid axis");
    };
  }
}
