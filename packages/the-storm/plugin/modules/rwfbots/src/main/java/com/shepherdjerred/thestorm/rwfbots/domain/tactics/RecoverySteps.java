package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.OptionalInt;

/** Where a bot whose route failed steps to, and when it is stranded on a climb instead. */
final class RecoverySteps {
  private RecoverySteps() {}

  /**
   * Whether the bot holds onto a climb from which no spawn can be reached, such as vines hanging
   * under an island or a shaft whose top is a ceiling: climbing on only keeps it hanging there.
   */
  static boolean strandedOnClimb(Situation situation, TacticsContext context) {
    var graph = context.nav().graph();
    var start = start(graph, situation.self().pos());
    if (start.isEmpty() || !graph.climbable(start.getAsInt())) return false;
    var spawns = spawnNodes(context);
    return !spawns.isEmpty() && !reachesAny(graph, start.getAsInt(), spawns);
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
