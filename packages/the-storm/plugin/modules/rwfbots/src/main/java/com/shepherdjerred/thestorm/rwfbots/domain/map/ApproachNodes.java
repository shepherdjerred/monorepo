package com.shepherdjerred.thestorm.rwfbots.domain.map;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import java.util.ArrayList;
import java.util.BitSet;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.OptionalInt;

/** Selects bomb interaction positions during baking, with bounded lookups during a match. */
final class ApproachNodes {
  private static final double EYE_HEIGHT = 1.62;
  private static final double REACH = 3.0;
  private static final int RADIUS = 4;

  private ApproachNodes() {}

  static Map<String, Integer> bake(NavGraph graph, VoxelGrid grid, NavSites sites) {
    var shared = reachableFromSpawns(graph, sites);
    var targets = new HashMap<String, Integer>();
    for (var bomb : sites.bombs()) {
      var candidates = candidates(graph, bomb.cell());
      candidates.removeIf(node -> !canInteract(graph, grid, node, bomb.cell()));
      candidates.sort(
          Comparator.comparingDouble(node -> graph.feet(node).distance(bomb.cell().feet())));
      if (!candidates.isEmpty()) {
        // Retain a real interaction position when disconnected so validation reports the
        // unreachable spawn; never substitute an arbitrary nearby node or omit the objective.
        var target =
            candidates.stream().filter(shared::get).findFirst().orElseGet(candidates::getFirst);
        targets.put(bomb.name(), target);
      }
    }
    return targets;
  }

  static OptionalInt baked(NavGraph graph, BlockPos bomb, DistanceField field) {
    return candidates(graph, bomb).stream()
        .filter(node -> field.at(node) == 0)
        .mapToInt(Integer::intValue)
        .findFirst();
  }

  private static BitSet reachableFromSpawns(NavGraph graph, NavSites sites) {
    var shared = new BitSet(graph.nodeCount());
    shared.set(0, graph.nodeCount());
    for (var spawn : sites.spawns()) {
      var from = graph.nodeAt(spawn.cell());
      if (from.isEmpty()) continue;
      var costs = graph.costsFrom(from.getAsInt());
      for (var node = shared.nextSetBit(0); node >= 0; node = shared.nextSetBit(node + 1)) {
        if (!Float.isFinite(costs[node])) shared.clear(node);
      }
    }
    return shared;
  }

  private static List<Integer> candidates(NavGraph graph, BlockPos bomb) {
    var nodes = new ArrayList<Integer>();
    for (var y = -RADIUS; y <= RADIUS; y++) {
      for (var z = -RADIUS; z <= RADIUS; z++) {
        for (var x = -RADIUS; x <= RADIUS; x++) {
          graph.nodeAt(bomb.offset(x, y, z)).ifPresent(nodes::add);
        }
      }
    }
    return nodes;
  }

  private static boolean canInteract(NavGraph graph, VoxelGrid grid, int node, BlockPos bomb) {
    var eye = graph.feet(node).plus(0, EYE_HEIGHT, 0);
    if (eye.distance(bomb.center()) > REACH) return false;
    var hit = grid.raycast(eye, bomb.center(), VoxelGrid.Layer.PROJECTILE);
    return hit.isEmpty() || hit.get().equals(bomb);
  }
}
