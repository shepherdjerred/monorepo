package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.OptionalInt;

/** Where a bot whose route failed steps to, and when it is stranded on a climb instead. */
final class RecoverySteps {
  /** How far a stranded bot looks for ground it can get home from, in blocks. */
  static final int ESCAPE_REACH = 4;

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
   * Where a bot stranded in a sink, off any climb, heads straight for: the nearest node within
   * {@link #ESCAPE_REACH} blocks from which a spawn can be reached, such as the bank of a pool the
   * graph has no exit from. Its body climbs out onto the bank as a player does. Empty when the bot
   * is not stranded or no such node is in reach.
   */
  static Optional<Vec3> escape(Situation situation, TacticsContext context) {
    var graph = context.nav().graph();
    var self = situation.self().pos();
    var start = start(graph, self);
    var spawns = spawnNodes(context);
    if (start.isEmpty()
        || spawns.isEmpty()
        || graph.climbable(start.getAsInt())
        || reachesAny(graph, start.getAsInt(), spawns)) return Optional.empty();
    return nearestAnchored(graph, self, spawns);
  }

  /** The node within {@link #ESCAPE_REACH} of {@code self} nearest it that reaches a spawn. */
  private static Optional<Vec3> nearestAnchored(NavGraph graph, Vec3 self, List<Integer> spawns) {
    return around(graph, BlockPos.of(self)).stream()
        .filter(node -> reachesAny(graph, node, spawns))
        .map(graph::feet)
        .min(Comparator.comparingDouble(feet -> feet.distance(self)));
  }

  /** The nodes in the cells within {@link #ESCAPE_REACH} across and a block down to two up. */
  private static List<Integer> around(NavGraph graph, BlockPos base) {
    var nodes = new ArrayList<Integer>();
    for (var dx = -ESCAPE_REACH; dx <= ESCAPE_REACH; dx++) {
      for (var dz = -ESCAPE_REACH; dz <= ESCAPE_REACH; dz++) {
        for (var dy = -1; dy <= 2; dy++)
          graph.nodeAt(base.offset(dx, dy, dz)).ifPresent(nodes::add);
      }
    }
    return nodes;
  }

  /**
   * Whether the bot holds onto a climb from which no spawn can be reached, such as vines hanging
   * under an island or a shaft whose top is a ceiling: climbing on only keeps it hanging there.
   */
  static boolean strandedOnClimb(Situation situation, TacticsContext context) {
    var graph = context.nav().graph();
    var start = start(graph, situation.self().pos());
    return start.isPresent()
        && graph.climbable(start.getAsInt())
        && sink(context, start.getAsInt());
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
