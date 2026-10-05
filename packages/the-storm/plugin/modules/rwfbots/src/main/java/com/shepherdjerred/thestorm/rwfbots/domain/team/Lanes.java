package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.ApproachRoutes;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavPath;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * Builds a team's lanes towards an objective: the baked approach routes, plus wide lanes forced
 * through points to either side of the straight line, kept only when they lie at least {@link
 * #MIN_GAP} blocks apart sideways. On an open map the baked routes hug the straight line, so the
 * wide lanes are what spread a team out.
 */
public final class Lanes {

  /** How far to either side of the midpoint the wide lanes are forced through, in blocks. */
  public static final double SPREAD = 14;

  /** Two lanes closer than this sideways count as the same lane. */
  public static final double MIN_GAP = 5;

  /** How many graph steps around a lane its corridor reaches. */
  static final int CORRIDOR_STEPS = 2;

  private static final int SNAP_RADIUS = 6;

  private Lanes() {}

  /**
   * The lanes from {@code home} to {@code goal}, ordered by sideways offset; empty when neither end
   * stands near a walkable node or no path joins them.
   *
   * @param graph the nav graph
   * @param home where the team starts
   * @param goal the objective's approach point
   * @param baked the baked routes between the two, if any
   */
  public static List<Lane> toward(
      NavGraph graph, Vec3 home, Vec3 goal, List<ApproachRoutes.Route> baked) {
    var from = graph.nearestNodeWithin(home, SNAP_RADIUS);
    var to = graph.nearestNodeWithin(goal, SNAP_RADIUS);
    if (from.isEmpty() || to.isEmpty()) {
      return List.of();
    }
    var axis = goal.minus(home).horizontal();
    if (axis.isZero()) {
      return List.of();
    }
    var side = new Vec3(-axis.normalized().z(), 0, axis.normalized().x());
    var candidates = new ArrayList<List<Integer>>();
    graph.path(from.getAsInt(), to.getAsInt()).ifPresent(path -> candidates.add(path.nodes()));
    var middle = home.lerp(goal, 0.5);
    for (var offset : new double[] {-SPREAD, SPREAD}) {
      via(graph, from.getAsInt(), to.getAsInt(), middle.plus(side.scale(offset)))
          .ifPresent(candidates::add);
    }
    for (var route : baked) {
      candidates.add(route.nodes());
    }
    var lanes = new ArrayList<Lane>();
    for (var nodes : candidates) {
      var lane = lane(graph, nodes, home, side);
      if (lanes.stream().allMatch(kept -> Math.abs(kept.lateral() - lane.lateral()) >= MIN_GAP)) {
        lanes.add(lane);
      }
    }
    lanes.sort(Comparator.comparingDouble(Lane::lateral));
    return List.copyOf(lanes);
  }

  /** The path from {@code from} to {@code to} through the node nearest {@code through}. */
  private static Optional<List<Integer>> via(NavGraph graph, int from, int to, Vec3 through) {
    var middle = graph.nearestNodeWithin(through, SNAP_RADIUS);
    if (middle.isEmpty()) {
      return Optional.empty();
    }
    var first = graph.path(from, middle.getAsInt());
    var second = graph.path(middle.getAsInt(), to);
    if (first.isEmpty() || second.isEmpty()) {
      return Optional.empty();
    }
    var nodes = new ArrayList<>(first.map(NavPath::nodes).orElseThrow());
    var rest = second.map(NavPath::nodes).orElseThrow();
    nodes.addAll(rest.subList(1, rest.size()));
    return Optional.of(nodes);
  }

  private static Lane lane(NavGraph graph, List<Integer> nodes, Vec3 home, Vec3 side) {
    var points = new ArrayList<Vec3>(nodes.size());
    var lateral = 0.0;
    for (var node : nodes) {
      var feet = graph.feet(node);
      points.add(feet);
      var offset = feet.minus(home).horizontal().dot(side);
      if (Math.abs(offset) > Math.abs(lateral)) {
        lateral = offset;
      }
    }
    return new Lane(nodes, points, corridor(graph, nodes), lateral);
  }

  /** The nodes within {@link #CORRIDOR_STEPS} graph steps of {@code nodes}. */
  static Set<Integer> corridor(NavGraph graph, List<Integer> nodes) {
    var seen = new HashSet<Integer>(nodes);
    var frontier = new ArrayDeque<Integer>(seen);
    for (var step = 0; step < CORRIDOR_STEPS; step++) {
      var next = new ArrayDeque<Integer>();
      for (var node : frontier) {
        for (var edge = graph.edgeStart(node); edge < graph.edgeEnd(node); edge++) {
          var target = graph.edgeTarget(edge);
          if (seen.add(target)) {
            next.add(target);
          }
        }
      }
      frontier = next;
    }
    return seen;
  }

  /** The lane that best matches {@code which}: the leftmost, the middle or the rightmost. */
  public static int pick(List<Lane> lanes, Which which) {
    if (lanes.isEmpty()) {
      return -1;
    }
    return switch (which) {
      case LEFT -> 0;
      case MIDDLE -> lanes.size() / 2;
      case RIGHT -> lanes.size() - 1;
    };
  }

  /** A lane picked by its side of the straight line. */
  public enum Which {
    LEFT,
    MIDDLE,
    RIGHT
  }
}
