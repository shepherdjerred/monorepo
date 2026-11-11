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
 * through two points to either side of the straight line (from 30% to 70% of the way), kept only
 * when they lie at least {@link #MIN_GAP} blocks apart sideways. On an open map the baked routes
 * hug the straight line, so the wide lanes are what spread a team out.
 */
public final class Lanes {

  /** How far to either side of the midpoint the wide lanes are forced through, in blocks. */
  public static final double SPREAD = 14;

  /** The wide lanes run at full width between these fractions of the way to the objective. */
  static final double WIDE_FROM = 0.3;

  static final double WIDE_TO = 0.7;

  /** Two lanes closer than this sideways count as the same lane. */
  public static final double MIN_GAP = 5;

  /** How many physically adjacent graph steps around a lane its corridor reaches. */
  static final int CORRIDOR_STEPS = 2;

  /** Cost added to a main-lane interior node so a side route is preferred when one exists. */
  private static final double AVOID = 1000;

  /** Extra cost on a node that is not clearly below the main lane, for the low-route search. */
  private static final double LOW_STEP = 50;

  /** A detour longer than this times the main route is just a wander. */
  private static final double LENGTH_RATIO = 1.5;

  /** Interior nodes shared with the main lane, as a fraction of the detour's own interior. */
  private static final double SHARE_FRACTION = 0.2;

  /** Or fewer than this many shared interior nodes, whichever is the looser test. */
  private static final int SHARE_NODES = 4;

  /** How far below the main lane a low route's mean feet must sit, in blocks. */
  private static final double LOW_DROP = 3;

  /** A node this far below the main mean is the low route, and is not taxed. */
  private static final double BELOW = 2;

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
    var main = graph.path(from.getAsInt(), to.getAsInt());
    main.ifPresent(path -> candidates.add(path.nodes()));
    for (var offset : new double[] {-SPREAD, SPREAD}) {
      var out = side.scale(offset);
      via(
              graph,
              from.getAsInt(),
              to.getAsInt(),
              List.of(home.lerp(goal, WIDE_FROM).plus(out), home.lerp(goal, WIDE_TO).plus(out)))
          .ifPresent(candidates::add);
    }
    for (var route : baked) {
      candidates.add(route.nodes());
    }
    var lanes = new ArrayList<Lane>();
    for (var nodes : candidates) {
      var lane = lane(graph, nodes, home, side, false);
      if (lanes.stream().allMatch(kept -> Math.abs(kept.lateral() - lane.lateral()) >= MIN_GAP)) {
        lanes.add(lane);
      }
    }
    lanes.sort(Comparator.comparingDouble(Lane::lateral));
    // A side hall closer than MIN_GAP, or a tunnel under the main lane, is appended after the
    // sort so it cannot become the leftmost or rightmost lane.
    if (main.isPresent()) {
      for (var nodes : detours(graph, from.getAsInt(), to.getAsInt(), main.orElseThrow().nodes())) {
        lanes.add(lane(graph, nodes, home, side, true));
      }
    }
    return List.copyOf(lanes);
  }

  /**
   * Routes that share little of the main lane and are not much longer: first any such route, then
   * a route that also runs clearly lower, when that is a different path.
   */
  private static List<List<Integer>> detours(NavGraph graph, int from, int to, List<Integer> main) {
    var interior = new HashSet<Integer>();
    if (main.size() > 2) {
      interior.addAll(main.subList(1, main.size() - 1));
    }
    var mainMean = meanY(graph, main);
    var out = new ArrayList<List<Integer>>();
    graph
        .path(from, to, node -> interior.contains(node) ? AVOID : 0)
        .filter(path -> keep(graph, path.nodes(), main, interior, false, mainMean))
        .ifPresent(path -> out.add(path.nodes()));
    graph
        .path(from, to, node -> lowPenalty(graph, node, interior, mainMean))
        .filter(path -> keep(graph, path.nodes(), main, interior, true, mainMean))
        .filter(path -> out.stream().noneMatch(kept -> kept.equals(path.nodes())))
        .ifPresent(path -> out.add(path.nodes()));
    return out;
  }

  private static double lowPenalty(
      NavGraph graph, int node, Set<Integer> interior, double mainMean) {
    var penalty = interior.contains(node) ? AVOID : 0.0;
    if (graph.feet(node).y() > mainMean - BELOW) {
      penalty += LOW_STEP;
    }
    return penalty;
  }

  private static boolean keep(
      NavGraph graph,
      List<Integer> nodes,
      List<Integer> main,
      Set<Integer> interior,
      boolean low,
      double mainMean) {
    if (nodes.equals(main)) {
      return false;
    }
    var mainLength = length(graph, main);
    var pathLength = length(graph, nodes);
    if (mainLength < 1 || pathLength > LENGTH_RATIO * mainLength) {
      return false;
    }
    var shared = 0;
    var count = 0;
    for (var i = 1; i < nodes.size() - 1; i++) {
      count++;
      if (interior.contains(nodes.get(i))) {
        shared++;
      }
    }
    var few = shared < SHARE_NODES || count == 0 || (double) shared / count < SHARE_FRACTION;
    if (!few) {
      return false;
    }
    return !low || mainMean - meanY(graph, nodes) >= LOW_DROP;
  }

  private static double length(NavGraph graph, List<Integer> nodes) {
    var total = 0.0;
    for (var i = 1; i < nodes.size(); i++) {
      total += graph.feet(nodes.get(i - 1)).distance(graph.feet(nodes.get(i)));
    }
    return total;
  }

  private static double meanY(NavGraph graph, List<Integer> nodes) {
    var sum = 0.0;
    for (var node : nodes) {
      sum += graph.feet(node).y();
    }
    return sum / nodes.size();
  }

  /** The path from {@code from} to {@code to} through the nodes nearest each of {@code through}. */
  private static Optional<List<Integer>> via(NavGraph graph, int from, int to, List<Vec3> through) {
    var stops = new ArrayList<Integer>();
    stops.add(from);
    for (var point : through) {
      var node = graph.nearestNodeWithin(point, SNAP_RADIUS);
      if (node.isEmpty()) {
        return Optional.empty();
      }
      stops.add(node.getAsInt());
    }
    stops.add(to);
    var nodes = new ArrayList<Integer>();
    nodes.add(from);
    for (var i = 1; i < stops.size(); i++) {
      var leg = graph.path(stops.get(i - 1), stops.get(i));
      if (leg.isEmpty()) {
        return Optional.empty();
      }
      var legNodes = leg.map(NavPath::nodes).orElseThrow();
      nodes.addAll(legNodes.subList(1, legNodes.size()));
    }
    return Optional.of(nodes);
  }

  private static Lane lane(
      NavGraph graph, List<Integer> nodes, Vec3 home, Vec3 side, boolean cut) {
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
    return new Lane(nodes, points, corridor(graph, nodes), lateral, cut);
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
          if (adjacent(graph, node, target) && seen.add(target)) {
            next.add(target);
          }
        }
      }
      frontier = next;
    }
    return seen;
  }

  /** A long leap or fluid portal must not widen a two-block lane across the whole room. */
  private static boolean adjacent(NavGraph graph, int node, int target) {
    var delta = graph.feet(node).minus(graph.feet(target));
    return Math.abs(delta.x()) <= 1 && Math.abs(delta.z()) <= 1 && Math.abs(delta.y()) <= 1.5;
  }

  /**
   * The lane that best matches {@code which}: the leftmost, the middle or the rightmost of the main
   * lanes. A side passage is never picked here.
   */
  public static int pick(List<Lane> lanes, Which which) {
    var primary = lanes.stream().filter(lane -> !lane.cut()).toList();
    if (primary.isEmpty()) {
      return -1;
    }
    var chosen =
        switch (which) {
          case LEFT -> primary.getFirst();
          case MIDDLE -> primary.get(primary.size() / 2);
          case RIGHT -> primary.getLast();
        };
    return lanes.indexOf(chosen);
  }

  /** A lane picked by its side of the straight line. */
  public enum Which {
    LEFT,
    MIDDLE,
    RIGHT
  }
}
