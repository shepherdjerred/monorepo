package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import java.util.Optional;
import java.util.Set;
import java.util.function.IntToDoubleFunction;

/**
 * The extra cost a bot pays to step onto each nav node, so teammates with the same goal still walk
 * different ways: seeded noise per bot over patches of the map, a toll on the nodes teammates are
 * about to walk (and their neighbours), and a toll for leaving the corridor of the lane the bot's
 * slot routes along. Every part is deterministic in the bot's seed and the team board.
 */
public final class RoutePenalty {

  /** The most a noisy patch adds per node. */
  public static final double NOISE = 0.6;

  /** The toll per node a teammate is about to walk, or stands next to. */
  public static final double OCCUPIED = 1.2;

  /** The toll per node outside the assigned lane's corridor. */
  public static final double OFF_LANE = 0.8;

  /** Noise is constant over square patches this many blocks wide, so it bends whole routes. */
  static final int PATCH_SHIFT = 2;

  private RoutePenalty() {}

  /**
   * What the bot's team and plan add to its route.
   *
   * @param occupied the nodes teammates are about to walk
   * @param corridor the corridor of the bot's lane, when it should keep to one
   * @param extra any other penalty, such as a last survivor's stealth
   */
  public record Tolls(
      Set<Integer> occupied, Optional<Set<Integer>> corridor, IntToDoubleFunction extra) {}

  /** The penalty for a bot with {@code seed} paying {@code tolls} on {@code graph}. */
  public static IntToDoubleFunction of(NavGraph graph, long seed, Tolls tolls) {
    var occupied = tolls.occupied();
    var corridor = tolls.corridor();
    var extra = tolls.extra();
    return node -> {
      var cell = graph.cell(node);
      var penalty = NOISE * noise(seed, cell.x() >> PATCH_SHIFT, cell.z() >> PATCH_SHIFT);
      if (!occupied.isEmpty() && near(graph, node, occupied)) {
        penalty += OCCUPIED;
      }
      if (corridor.isPresent() && !corridor.orElseThrow().contains(node)) {
        penalty += OFF_LANE;
      }
      return penalty + extra.applyAsDouble(node);
    };
  }

  private static boolean near(NavGraph graph, int node, Set<Integer> occupied) {
    if (occupied.contains(node)) {
      return true;
    }
    for (var edge = graph.edgeStart(node); edge < graph.edgeEnd(node); edge++) {
      if (occupied.contains(graph.edgeTarget(edge))) {
        return true;
      }
    }
    return false;
  }

  /** A uniform value in [0, 1) for patch ({@code x}, {@code z}) under {@code seed}. */
  static double noise(long seed, int x, int z) {
    var mixed = seed ^ (x * 0x9E3779B97F4A7C15L) ^ (z * 0xC2B2AE3D27D4EB4FL);
    mixed ^= mixed >>> 33;
    mixed *= 0xFF51AFD7ED558CCDL;
    mixed ^= mixed >>> 33;
    mixed *= 0xC4CEB9FE1A85EC53L;
    mixed ^= mixed >>> 33;
    return (mixed >>> 11) * 0x1.0p-53;
  }
}
