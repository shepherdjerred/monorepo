package com.shepherdjerred.thestorm.skylands.domain;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.PriorityQueue;
import java.util.Set;

/**
 * Bounded deterministic A* over original shelves. Failure rejects a plot, never fabricates land.
 */
public final class SkyRoutes {
  public enum Mode {
    VILLAGE,
    RUINS
  }

  private record Node(SkyPosition point, double cost, double priority, long order) {}

  private static final List<SkyPosition> DIRECTIONS =
      List.of(
          new SkyPosition(1, 0, 0),
          new SkyPosition(-1, 0, 0),
          new SkyPosition(0, 0, 1),
          new SkyPosition(0, 0, -1));
  private final TerrainWindow terrain;
  private final SkyBounds area;
  private final List<SkyPiece> plots;

  public SkyRoutes(TerrainWindow terrain, SkyBounds area, List<SkyPiece> plots) {
    this.terrain = terrain;
    this.area = area;
    this.plots = List.copyOf(plots);
  }

  public Optional<SkyRoute> find(SkyPosition start, Set<SkyPosition> goals, Mode mode) {
    if (goals.isEmpty()) throw new IllegalArgumentException("A route needs a destination");
    var index = new SkyGoals(goals);
    var queue =
        new PriorityQueue<>(
            Comparator.comparingDouble(Node::priority).thenComparingLong(Node::order));
    var costs = new HashMap<SkyPosition, Double>();
    var previous = new HashMap<SkyPosition, SkyRoute.Segment>();
    costs.put(start, 0.0);
    long order = 0;
    queue.add(new Node(start, 0, index.distance(start), order++));
    while (!queue.isEmpty() && costs.size() <= 16_000) {
      var node = queue.remove();
      if (node.cost() != java.util.Objects.requireNonNull(costs.get(node.point()))) continue;
      if (index.contains(node.point())) return Optional.of(reconstruct(node.point(), previous));
      for (var edge : edges(node.point(), mode, index)) {
        var cost = node.cost() + cost(edge, mode);
        if (cost >= costs.getOrDefault(edge.to(), Double.POSITIVE_INFINITY) || cost > 220) continue;
        costs.put(edge.to(), cost);
        previous.put(edge.to(), edge);
        queue.add(new Node(edge.to(), cost, cost + index.distance(edge.to()), order++));
      }
    }
    return Optional.empty();
  }

  private List<SkyRoute.Segment> edges(SkyPosition p, Mode mode, SkyGoals goals) {
    var out = new ArrayList<SkyRoute.Segment>();
    for (var direction : DIRECTIONS) {
      for (var dy : List.of(0, -1, 1)) {
        var q = p.add(direction).above(dy);
        if (goals.compatible(q)
            && walkable(q, mode)
            && (mode == Mode.RUINS || terrain.air(p.above(Math.max(0, dy) + 1)))) {
          out.add(new SkyRoute.Segment(p, q, SkyRoute.Kind.WALK));
        }
      }
      bridge(p, direction, goals).ifPresent(out::add);
      if (mode == Mode.RUINS) cliff(p, direction).ifPresent(out::add);
    }
    return out;
  }

  private boolean free(SkyPosition p) {
    return area.contains(p)
        && area.contains(p.above(2))
        && plots.stream().noneMatch(plot -> plot.bounds().contains(p));
  }

  private boolean walkable(SkyPosition p, Mode mode) {
    if (!free(p) || !terrain.footing(p.above(-1), 2)) return false;
    if (mode == Mode.VILLAGE)
      return terrain.air(p) && terrain.air(p.above(1)) && terrain.air(p.above(2));
    // A narrow ruin passage may cut existing rock; never carve water or a district-sized cavern.
    return (terrain.air(p) || terrain.solid(p))
        && (terrain.air(p.above(1)) || terrain.solid(p.above(1)));
  }

  private Optional<SkyRoute.Segment> bridge(
      SkyPosition start, SkyPosition direction, SkyGoals goals) {
    if (!bridgeLanding(start, direction)) return Optional.empty();
    var voidColumns = 0;
    for (var t = 1; t <= 32; t++) {
      var p = start.add(new SkyPosition(direction.x() * t, 0, direction.z() * t));
      if (!goals.compatible(p) || !bridgeSection(p, direction)) break;
      if (!terrain.footing(p.above(-1), 2)) voidColumns++;
      if (t >= 4 && voidColumns >= 3 && bridgeLanding(p, direction)) {
        return Optional.of(new SkyRoute.Segment(start, p, SkyRoute.Kind.BRIDGE));
      }
    }
    return Optional.empty();
  }

  private boolean bridgeLanding(SkyPosition p, SkyPosition direction) {
    for (var side = -2; side <= 2; side++) {
      var q = p.add(new SkyPosition(-direction.z() * side, -1, direction.x() * side));
      if (!terrain.solid(q)) return false;
    }
    return true;
  }

  private boolean bridgeSection(SkyPosition p, SkyPosition direction) {
    for (var side = -2; side <= 2; side++) {
      var q = p.add(new SkyPosition(-direction.z() * side, 0, direction.x() * side));
      for (var y = -1; y <= 2; y++) {
        if (!free(q.above(y)) || (y >= 0 && !terrain.air(q.above(y)))) return false;
      }
    }
    return true;
  }

  private Optional<SkyRoute.Segment> cliff(SkyPosition start, SkyPosition direction) {
    if (!terrain.solid(start.above(-1))) return Optional.empty();
    for (var height = 1; height <= 24; height++) {
      var p = start.above(height);
      if (!free(p) || !terrain.air(p) || !terrain.air(p.above(1))) break;
      var backing = p.add(direction);
      if (!terrain.solid(backing.above(-1))) break;
      if (height >= 3
          && walkable(backing, Mode.RUINS)
          && terrain.air(backing)
          && terrain.air(backing.above(1))) {
        return Optional.of(new SkyRoute.Segment(start, backing, SkyRoute.Kind.CLIFF));
      }
    }
    return Optional.empty();
  }

  private double cost(SkyRoute.Segment edge, Mode mode) {
    var a = edge.from();
    var b = edge.to();
    var distance = Math.abs(a.x() - b.x()) + Math.abs(a.y() - b.y()) + Math.abs(a.z() - b.z());
    var carve = mode == Mode.RUINS && (!terrain.air(b) || !terrain.air(b.above(1))) ? 5 : 0;
    return distance + carve + (edge.kind() == SkyRoute.Kind.WALK ? 0 : 4);
  }

  private static SkyRoute reconstruct(
      SkyPosition end, Map<SkyPosition, SkyRoute.Segment> previous) {
    var edges = new ArrayList<SkyRoute.Segment>();
    var p = end;
    while (previous.containsKey(p)) {
      var edge = previous.get(p);
      edges.add(edge);
      p = edge.from();
    }
    Collections.reverse(edges);
    return new SkyRoute(edges);
  }
}
