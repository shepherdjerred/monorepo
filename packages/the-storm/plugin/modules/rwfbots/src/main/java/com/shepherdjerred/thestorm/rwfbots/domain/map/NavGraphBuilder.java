package com.shepherdjerred.thestorm.rwfbots.domain.map;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Finds the cells a player can stand in and connects them. A cell is a node when a player fits (it
 * and the cell above are passable) and something holds them: a standable block below, a ladder in
 * the cell, or water to swim in.
 */
final class NavGraphBuilder {

  private static final float SWIM_FACTOR = 2.5f;

  private final BlockClassification blocks;
  private final GridBounds bounds;
  private final int[] nodeOfCell;
  private final List<Integer> cellOfNode = new ArrayList<>();

  private NavGraphBuilder(BlockClassification blocks) {
    this.blocks = blocks;
    this.bounds = blocks.bounds();
    this.nodeOfCell = new int[bounds.volume()];
    Arrays.fill(nodeOfCell, -1);
  }

  static NavGraph build(BlockClassification blocks) {
    var builder = new NavGraphBuilder(blocks);
    builder.findNodes();
    return builder.connect();
  }

  private void findNodes() {
    var origin = bounds.origin();
    for (var y = 0; y < bounds.sizeY(); y++) {
      for (var z = 0; z < bounds.sizeZ(); z++) {
        for (var x = 0; x < bounds.sizeX(); x++) {
          var cell = new BlockPos(origin.x() + x, origin.y() + y, origin.z() + z);
          if (isNode(cell)) {
            nodeOfCell[bounds.index(cell)] = cellOfNode.size();
            cellOfNode.add(bounds.index(cell));
          }
        }
      }
    }
  }

  private boolean isNode(BlockPos cell) {
    if (!passable(cell) || !passable(cell.up())) {
      return false;
    }
    var shape = shape(cell);
    // This controller swims at the surface; it has no dive action. A deep ocean otherwise
    // creates millions of duplicate horizontal routes at depths the bot cannot follow.
    if (shape.swim() && shape(cell.up()).swim()) return false;
    return shape.climbable() || shape.swim() || standable(cell.down());
  }

  private BlockShape shape(BlockPos cell) {
    if (!bounds.contains(cell)) {
      return BlockShape.FULL;
    }
    return blocks.shape(cell.x(), cell.y(), cell.z());
  }

  private boolean passable(BlockPos cell) {
    return bounds.contains(cell) && !shape(cell).blocksMovement();
  }

  private boolean standable(BlockPos cell) {
    return bounds.contains(cell) && shape(cell).standable();
  }

  private int nodeAt(BlockPos cell) {
    return bounds.contains(cell) ? nodeOfCell[bounds.index(cell)] : -1;
  }

  private NavGraph connect() {
    var n = cellOfNode.size();
    var edgeStart = new int[n + 1];
    var targets = new ArrayList<Integer>();
    var hops = new ArrayList<Hop>();
    var costs = new ArrayList<Float>();
    for (var node = 0; node < n; node++) {
      var cell = bounds.cell(cellOfNode.get(node));
      var edges = new ArrayList<Edge>();
      horizontal(cell, edges);
      vertical(cell, edges);
      for (var edge : edges) {
        targets.add(edge.to());
        hops.add(edge.hop());
        costs.add(edge.cost());
      }
      edgeStart[node + 1] = targets.size();
    }
    var edgeTo = new int[targets.size()];
    var hop = new byte[targets.size()];
    var cost = new float[targets.size()];
    for (var i = 0; i < targets.size(); i++) {
      edgeTo[i] = targets.get(i);
      hop[i] = hops.get(i).code();
      cost[i] = costs.get(i);
    }
    var cells = cellOfNode.stream().mapToInt(Integer::intValue).toArray();
    return new NavGraph(
        bounds, cells, new NavGraph.Topology(edgeStart, edgeTo), new NavGraph.EdgeData(hop, cost));
  }

  private record Edge(int to, Hop hop, float cost) {}

  private void horizontal(BlockPos cell, List<Edge> edges) {
    int[][] cardinal = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
    for (var d : cardinal) {
      step(cell, d[0], d[1], edges);
      leap(cell, d[0], d[1], edges);
    }
    int[][] diagonal = {{1, 1}, {1, -1}, {-1, 1}, {-1, -1}};
    for (var d : diagonal) {
      var sideA = cell.offset(d[0], 0, 0);
      var sideB = cell.offset(0, 0, d[1]);
      if (fits(sideA) && fits(sideB)) {
        var target = nodeAt(cell.offset(d[0], 0, d[1]));
        if (target >= 0) {
          edges.add(new Edge(target, Hop.WALK, scale(cell, NavGraph.DIAGONAL_COST)));
        }
      }
    }
  }

  /** Walk level, jump up one, or descend a bounded fall along one cardinal direction. */
  private void step(BlockPos cell, int dx, int dz, List<Edge> edges) {
    var ahead = cell.offset(dx, 0, dz);
    var level = nodeAt(ahead);
    if (level >= 0) {
      edges.add(new Edge(level, Hop.WALK, scale(cell, NavGraph.WALK_COST)));
      return;
    }
    var up = nodeAt(ahead.up());
    if (up >= 0 && passable(cell.offset(0, 2, 0))) {
      edges.add(new Edge(up, Hop.JUMP, NavGraph.JUMP_COST));
      return;
    }
    if (!fits(ahead)) {
      return;
    }
    for (var depth = 1; depth <= NavGraph.MAX_DROP; depth++) {
      var below = ahead.offset(0, -depth, 0);
      var landing = nodeAt(below);
      if (landing >= 0) {
        var fallPenalty = Math.max(0, depth - 3) * 4;
        edges.add(new Edge(landing, Hop.DROP, NavGraph.WALK_COST + depth + fallPenalty));
        return;
      }
      if (!passable(below)) {
        return;
      }
    }
  }

  private void vertical(BlockPos cell, List<Edge> edges) {
    var shape = shape(cell);
    var above = nodeAt(cell.up());
    if (above >= 0 && (shape.climbable() || shape(cell.up()).climbable())) {
      edges.add(new Edge(above, Hop.CLIMB, NavGraph.CLIMB_COST));
    }
    var below = nodeAt(cell.down());
    if (below >= 0 && (shape.climbable() || shape(cell.down()).climbable())) {
      edges.add(new Edge(below, Hop.CLIMB, NavGraph.CLIMB_COST));
    }
  }

  /** Short gaps on the original floating platforms need a sprint jump, sometimes downwards. */
  private void leap(BlockPos cell, int dx, int dz, List<Edge> edges) {
    if (!standable(cell.down()) || nodeAt(cell.offset(dx, 0, dz)) >= 0) return;
    for (var span = 2; span <= 3; span++) {
      for (var descent = 0; descent <= NavGraph.MAX_DROP; descent++) {
        var landing = cell.offset(dx * span, -descent, dz * span);
        var target = nodeAt(landing);
        if (target >= 0 && standable(landing.down()) && clearLeap(cell, landing)) {
          edges.add(
              new Edge(
                  target,
                  Hop.LEAP,
                  NavGraph.JUMP_COST + span + descent + Math.max(0, descent - 3) * 4));
          break;
        }
      }
    }
  }

  /** Conservatively clear the whole flight corridor, including headroom and the descent. */
  private boolean clearLeap(BlockPos from, BlockPos to) {
    var span = Math.max(Math.abs(to.x() - from.x()), Math.abs(to.z() - from.z()));
    var dx = Integer.signum(to.x() - from.x());
    var dz = Integer.signum(to.z() - from.z());
    for (var step = 0; step <= span; step++) {
      var lowest = step == 0 ? from.y() : to.y();
      for (var y = lowest; y <= from.y() + 3; y++) {
        if (!passable(from.offset(dx * step, y - from.y(), dz * step))) return false;
      }
    }
    return true;
  }

  /** Whether a player can be in {@code cell} (it and the cell above are passable). */
  private boolean fits(BlockPos cell) {
    return passable(cell) && passable(cell.up());
  }

  private float scale(BlockPos from, float cost) {
    return shape(from).swim() ? cost * SWIM_FACTOR : cost;
  }
}
