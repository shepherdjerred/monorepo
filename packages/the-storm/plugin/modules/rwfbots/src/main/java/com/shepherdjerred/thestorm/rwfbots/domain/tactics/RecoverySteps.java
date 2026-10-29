package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
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

  /** How recently a hurt body was hurt, in ticks, for it to keep stepping rather than hold. */
  private static final long HURTING = 20;

  /** The highest rise a walking body steps up without jumping, in blocks. */
  private static final double STEP = 0.6;

  private RecoverySteps() {}

  /**
   * Whether no spawn or bomb can be reached from {@code node} over any edge: a pool or a pit the
   * graph has no way out of. A map without spawns or bombs has no sinks.
   */
  static boolean sink(TacticsContext context, int node) {
    return sink(context, node, true);
  }

  /**
   * Whether no spawn or bomb can be reached from {@code node} over the edges a body takes: one that
   * may not sprint takes no sprint jump, so a pocket whose only way out is a run of them holds it
   * for good, as {@link #step} already knew.
   */
  static boolean sink(TacticsContext context, int node, boolean leaps) {
    return !context.nav().anchored(node, leaps);
  }

  /** Whether the body in {@code situation} can take sprint jumps. */
  static boolean leaps(Situation situation) {
    return situation.self().traversal().maySprint();
  }

  /** Whether a bot may be sent to stand at {@code node}: not in water and not in a sink. */
  static boolean leavable(TacticsContext context, int node) {
    return leavable(context, node, true);
  }

  private static boolean leavable(TacticsContext context, int node, boolean leaps) {
    var graph = context.nav().graph();
    return !graph.water().contains(graph.cell(node)) && !sink(context, node, leaps);
  }

  /**
   * Whether the bot may be sent to stand at {@code node}: {@link #leavable} and reachable from
   * where it stands. A cover point it cannot route to failed every route and kept a bot stepping
   * back and forth in recovery for over a minute (the-harshest-harvest).
   */
  static boolean usable(Situation situation, TacticsContext context, int node) {
    var graph = context.nav().graph();
    var from = start(graph, situation.self().pos());
    return leavable(context, node, leaps(situation))
        && (from.isEmpty() || graph.reachable(from.getAsInt(), node));
  }

  /**
   * The way out for a bot stranded in a sink, off any climb: along the graph through the sink (a
   * pool's swim edges) to the nearest node beside a bank at most a block up from which a spawn or a
   * bomb can be reached, then onto that bank, which a swimmer climbs as a player does. A higher
   * edge, such as a stair's half step above the water, cannot be climbed out onto. Empty when the
   * bot is not stranded or no such bank lies within {@link #ESCAPE_SEARCH} nodes.
   */
  static Optional<List<Waypoint>> escape(Situation situation, TacticsContext context) {
    var graph = context.nav().graph();
    var start = standingNode(graph, situation.self().pos());
    var leaps = leaps(situation);
    if (start.isEmpty()
        || graph.climbable(start.getAsInt())
        || !sink(context, start.getAsInt(), leaps)) return Optional.empty();
    return toBank(context.nav(), start.getAsInt(), leaps);
  }

  /** Breadth first from {@code start} to the first node with a climbable bank beside it. */
  private static Optional<List<Waypoint>> toBank(NavArtifact nav, int start, boolean leaps) {
    var graph = nav.graph();
    var via = new HashMap<Integer, Integer>();
    via.put(start, -1);
    var queue = new ArrayDeque<Integer>();
    queue.add(start);
    while (!queue.isEmpty() && via.size() <= ESCAPE_SEARCH) {
      var node = queue.remove();
      var bank = bankBeside(nav, node, leaps);
      if (bank.isPresent()) return Optional.of(path(graph, via, node, bank.orElseThrow()));
      for (var edge = graph.edgeStart(node); edge < graph.edgeEnd(node); edge++) {
        if (!leaps && graph.edgeHop(edge) == Hop.LEAP) continue;
        if (via.putIfAbsent(graph.edgeTarget(edge), edge) == null)
          queue.add(graph.edgeTarget(edge));
      }
    }
    return Optional.empty();
  }

  /**
   * The waypoint onto a node beside {@code node}, at most {@link #BANK_RISE} up, that reaches a
   * spawn or a bomb: a jump where a dry body must rise more than a step, which a walk cannot climb.
   * A dry body crossing diagonally needs both corners clear where it crosses, as the movement gate
   * does; floating-isles offered a bank past a solid corner, refused every time it was tried.
   */
  private static Optional<Waypoint> bankBeside(NavArtifact nav, int node, boolean leaps) {
    for (var cell : beside(nav.graph().cell(node))) {
      var bank = bankAt(nav, node, cell, leaps);
      if (bank.isPresent()) return bank;
    }
    return Optional.empty();
  }

  /** The waypoint onto the node at {@code cell} from {@code node}, when it is a usable bank. */
  private static Optional<Waypoint> bankAt(
      NavArtifact nav, int node, BlockPos cell, boolean leaps) {
    var graph = nav.graph();
    var from = graph.cell(node);
    var bank = graph.nodeAt(cell);
    var dry = !graph.water().contains(from);
    if (bank.isEmpty() || bank.getAsInt() == node || (dry && !cornersClear(nav, from, cell)))
      return Optional.empty();
    var rise = graph.feet(bank.getAsInt()).y() - graph.feet(node).y();
    var jump = dry && rise > STEP;
    // A jump needs headroom above the take-off, as the graph's own upward steps do.
    if ((jump && nav.grid().blocksMovement(from.offset(0, 2, 0)))
        || rise > BANK_RISE + 1e-6
        || !nav.anchored(bank.getAsInt(), leaps)) return Optional.empty();
    return Optional.of(new Waypoint(graph.feet(bank.getAsInt()), jump ? Hop.JUMP : Hop.WALK));
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

  /** Whether neither corner of a diagonal crossing onto {@code to} blocks a body at its height. */
  private static boolean cornersClear(NavArtifact nav, BlockPos from, BlockPos to) {
    var dx = to.x() - from.x();
    var dz = to.z() - from.z();
    if (dx == 0 || dz == 0) return true;
    for (var y = to.y(); y <= to.y() + 1; y++) {
      if (nav.grid().blocksMovement(new BlockPos(from.x() + dx, y, from.z()))
          || nav.grid().blocksMovement(new BlockPos(from.x(), y, from.z() + dz))) return false;
    }
    return true;
  }

  /**
   * Whether the bot is stranded on dry ground with no way out: holding is all that is left. A
   * swimmer is never told to hold, as it would sink and drown, nor a body still being hurt, which
   * may stand in the fire beside its pocket and steps off it instead.
   */
  static boolean trapped(Situation situation, TacticsContext context) {
    var graph = context.nav().graph();
    var self = situation.self();
    var hurting = self.lastHurtTick() >= 0 && situation.now() - self.lastHurtTick() <= HURTING;
    return !hurting
        && stranded(situation, context)
        && !graph.water().contains(BlockPos.of(self.pos()))
        && escape(situation, context).isEmpty();
  }

  /** The waypoints from the search's start to {@code end}, then onto {@code bank}. */
  private static List<Waypoint> path(
      NavGraph graph, Map<Integer, Integer> via, int end, Waypoint bank) {
    var waypoints = new ArrayList<Waypoint>();
    for (var edge = via.getOrDefault(end, -1);
        edge >= 0;
        edge = via.getOrDefault(graph.edgeSource(edge), -1)) waypoints.add(graph.waypoint(edge));
    Collections.reverse(waypoints);
    waypoints.add(bank);
    return waypoints;
  }

  /**
   * Whether the bot holds onto a climb from which no spawn or bomb can be reached, such as vines
   * hanging under an island or a shaft whose top is a ceiling: climbing on only keeps it hanging
   * there.
   */
  static boolean strandedOnClimb(Situation situation, TacticsContext context) {
    var graph = context.nav().graph();
    var start = standingNode(graph, situation.self().pos());
    return start.isPresent()
        && graph.climbable(start.getAsInt())
        && sink(context, start.getAsInt(), leaps(situation));
  }

  /**
   * Whether the bot stands where no spawn or bomb can be reached: on a dead-end climb or in a pool
   * or pit the graph has no way out of. Tactics re-plans its way out every step while it is, rather
   * than following a plan that would hold it where it stood.
   */
  static boolean stranded(Situation situation, TacticsContext context) {
    var start = standingNode(context.nav().graph(), situation.self().pos());
    return start.isPresent() && sink(context, start.getAsInt(), leaps(situation));
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

  /**
   * The recovery step: an adjacent node the body can actually move to (no leap for a body that may
   * not sprint, no diagonal that lets go of a ladder) that keeps it able to reach a spawn or a bomb
   * the way its body moves when it can now, preferring steps without fall damage. A raw edge led
   * bots off a walkway's end into the dead ground under an island, or to a leap their body refused
   * without a word.
   */
  static Optional<Vec3> step(Situation situation, TacticsContext context) {
    var graph = context.nav().graph();
    var from = start(graph, situation.self().pos());
    if (from.isEmpty()) return Optional.empty();
    var start = from.getAsInt();
    var leaps = leaps(situation);
    var nav = context.nav();
    var anchored = nav.anchored(start, leaps);
    var safe = new ArrayList<Integer>();
    var hurting = new ArrayList<Integer>();
    for (var edge = graph.edgeStart(start); edge < graph.edgeEnd(start); edge++) {
      if (graph.unheldClimbDiagonal(edge)
          || (graph.edgeHop(edge) == Hop.LEAP && !leaps)
          || (anchored && !nav.anchored(graph.edgeTarget(edge), leaps))) continue;
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
