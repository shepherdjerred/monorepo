package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalInt;

/** Where a bot whose route failed steps to, and when it is stranded on a climb instead. */
final class RecoverySteps {
  /** How many nodes a stranded bot searches for a bank it can climb out onto. */
  static final int ESCAPE_SEARCH = 512;

  /** How far a node's feet may be from the body's for the body to stand at it, in blocks. */
  private static final double STANDING = 1.5;

  /** The most a bank may rise above the water a swimmer climbs out of, in blocks. */
  static final double BANK_RISE = 1.0;

  private RecoverySteps() {}

  /**
   * Whether no spawn can be reached from {@code node}: a pool or a pit the graph has no way out of.
   * A map without spawns has no sinks.
   */
  static boolean sink(TacticsContext context, int node) {
    var spawns = spawnNodes(context);
    return !spawns.isEmpty() && !reachesAny(context.nav().graph(), node, spawns);
  }

  /** Whether a bot may be sent to stand at {@code node}: not in water and not in a sink. */
  static boolean leavable(TacticsContext context, int node) {
    var graph = context.nav().graph();
    return !graph.water().contains(graph.cell(node)) && !sink(context, node);
  }

  /**
   * Whether the bot may be sent to stand at {@code node}: {@link #leavable} and reachable from
   * where it stands. A cover point it cannot route to failed every route and kept a bot stepping
   * back and forth in recovery for over a minute (the-harshest-harvest).
   */
  static boolean usable(Situation situation, TacticsContext context, int node) {
    var graph = context.nav().graph();
    var from = start(graph, situation.self().pos());
    return leavable(context, node) && (from.isEmpty() || graph.reachable(from.getAsInt(), node));
  }

  /**
   * The way out for a bot stranded in a sink, off any climb: along the graph through the sink (a
   * pool's swim edges) to the nearest node beside a bank at most a block up from which a spawn can
   * be reached, then onto that bank, which a swimmer climbs as a player does. A higher edge, such
   * as a stair's half step above the water, cannot be climbed out onto. Empty when the bot is not
   * stranded or no such bank lies within {@link #ESCAPE_SEARCH} nodes.
   */
  static Optional<List<Waypoint>> escape(Situation situation, TacticsContext context) {
    var graph = context.nav().graph();
    var start = standingNode(graph, situation.self().pos());
    var spawns = spawnNodes(context);
    if (start.isEmpty()
        || spawns.isEmpty()
        || graph.climbable(start.getAsInt())
        || reachesAny(graph, start.getAsInt(), spawns)) return Optional.empty();
    return toBank(graph, start.getAsInt(), spawns);
  }

  /** Breadth first from {@code start} to the first node with a climbable bank beside it. */
  private static Optional<List<Waypoint>> toBank(NavGraph graph, int start, List<Integer> spawns) {
    var via = new HashMap<Integer, Integer>();
    via.put(start, -1);
    var queue = new ArrayDeque<Integer>();
    queue.add(start);
    while (!queue.isEmpty() && via.size() <= ESCAPE_SEARCH) {
      var node = queue.remove();
      var bank = bankBeside(graph, node, spawns);
      if (bank.isPresent()) return Optional.of(path(graph, via, node, bank.orElseThrow()));
      for (var edge = graph.edgeStart(node); edge < graph.edgeEnd(node); edge++) {
        if (via.putIfAbsent(graph.edgeTarget(edge), edge) == null)
          queue.add(graph.edgeTarget(edge));
      }
    }
    return Optional.empty();
  }

  /**
   * The feet of a node beside {@code node}, at most {@link #BANK_RISE} up, that reaches a spawn.
   */
  private static Optional<Vec3> bankBeside(NavGraph graph, int node, List<Integer> spawns) {
    var feet = graph.feet(node);
    for (var cell : beside(graph.cell(node))) {
      var bank = graph.nodeAt(cell);
      if (bank.isEmpty() || bank.getAsInt() == node) continue;
      var rise = graph.feet(bank.getAsInt()).y() - feet.y();
      if (rise <= BANK_RISE + 1e-6 && reachesAny(graph, bank.getAsInt(), spawns))
        return Optional.of(graph.feet(bank.getAsInt()));
    }
    return Optional.empty();
  }

  /** The cells around {@code cell} and the layer above them, level ones first. */
  private static List<BlockPos> beside(BlockPos cell) {
    var cells = new ArrayList<BlockPos>();
    for (var dy = 0; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        for (var dz = -1; dz <= 1; dz++) cells.add(cell.offset(dx, dy, dz));
      }
    }
    return cells;
  }

  /** The waypoints from the search's start to {@code end}, then onto {@code bank}. */
  private static List<Waypoint> path(
      NavGraph graph, Map<Integer, Integer> via, int end, Vec3 bank) {
    var waypoints = new ArrayList<Waypoint>();
    for (var edge = via.getOrDefault(end, -1);
        edge >= 0;
        edge = via.getOrDefault(graph.edgeSource(edge), -1)) waypoints.add(graph.waypoint(edge));
    Collections.reverse(waypoints);
    waypoints.add(new Waypoint(bank, Hop.WALK));
    return waypoints;
  }

  /**
   * Whether the bot holds onto a climb from which no spawn can be reached, such as vines hanging
   * under an island or a shaft whose top is a ceiling: climbing on only keeps it hanging there.
   */
  static boolean strandedOnClimb(Situation situation, TacticsContext context) {
    var graph = context.nav().graph();
    var start = standingNode(graph, situation.self().pos());
    return start.isPresent()
        && graph.climbable(start.getAsInt())
        && sink(context, start.getAsInt());
  }

  /**
   * Whether the bot stands where no spawn can be reached: on a dead-end climb or in a pool or pit
   * the graph has no way out of. Tactics re-plans its way out every step while it is, rather than
   * following a plan that would hold it where it stood.
   */
  static boolean stranded(Situation situation, TacticsContext context) {
    var start = standingNode(context.nav().graph(), situation.self().pos());
    return start.isPresent() && sink(context, start.getAsInt());
  }

  /**
   * The route start node when the body stands at it, not merely above or below it: the nearest node
   * is chosen mostly by horizontal distance, so a bot on an island's rim was matched to the vines
   * hanging under it and let go of a climb it was not on, standing still for minutes.
   */
  private static OptionalInt standingNode(NavGraph graph, Vec3 pos) {
    var node = start(graph, pos);
    if (node.isEmpty()) return node;
    // A deep water column keeps only its portal nodes, which may lie far above or below a swimmer.
    var swimming = graph.water().contains(BlockPos.of(pos));
    return swimming || Math.abs(graph.feet(node.getAsInt()).y() - pos.y()) < STANDING
        ? node
        : OptionalInt.empty();
  }

  /** The nodes the map's spawns are approached from. */
  private static List<Integer> spawnNodes(TacticsContext context) {
    var nodes = new ArrayList<Integer>();
    for (var site : context.nav().sites().spawns())
      context.nav().approachNode(site).ifPresent(nodes::add);
    return nodes;
  }

  private static boolean reachesAny(NavGraph graph, int from, List<Integer> targets) {
    for (var target : targets) if (graph.reachable(from, target)) return true;
    return false;
  }

  /**
   * The recovery step: an adjacent node the body can actually move to (no leap for a body that may
   * not sprint, no diagonal that lets go of a ladder) that keeps it able to reach a spawn when it
   * can now, preferring steps without fall damage. A raw edge led bots off a walkway's end into the
   * dead ground under an island, or to a leap their body refused without a word.
   */
  static Optional<Vec3> step(Situation situation, TacticsContext context) {
    var graph = context.nav().graph();
    var from = start(graph, situation.self().pos());
    if (from.isEmpty()) return Optional.empty();
    var start = from.getAsInt();
    var spawns = spawnNodes(context);
    var anchored = !spawns.isEmpty() && reachesAny(graph, start, spawns);
    var safe = new ArrayList<Integer>();
    var hurting = new ArrayList<Integer>();
    for (var edge = graph.edgeStart(start); edge < graph.edgeEnd(start); edge++) {
      if (graph.unheldClimbDiagonal(edge)
          || (graph.edgeHop(edge) == Hop.LEAP && !situation.self().traversal().maySprint())
          || (anchored && !reachesAny(graph, graph.edgeTarget(edge), spawns))) continue;
      (graph.edgeDamage(edge) == 0 ? safe : hurting).add(edge);
    }
    var steps = safe.isEmpty() ? hurting : safe;
    if (steps.isEmpty()) return Optional.empty();
    var edge =
        steps.get(
            Math.floorMod(situation.self().id().value() + situation.now() / 20, steps.size()));
    return Optional.of(graph.feet(graph.edgeTarget(edge)));
  }

  /** The node a route from {@code pos} starts at, as {@link Planner#pathTo} picks it. */
  static OptionalInt start(NavGraph graph, Vec3 pos) {
    var node = graph.nearestNode(pos);
    return node.isPresent() ? node : graph.nearestNodeWithin(pos, 3);
  }
}
