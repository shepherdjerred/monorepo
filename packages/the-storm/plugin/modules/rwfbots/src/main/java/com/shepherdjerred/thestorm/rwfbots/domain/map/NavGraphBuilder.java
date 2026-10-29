package com.shepherdjerred.thestorm.rwfbots.domain.map;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.BitSet;
import java.util.List;
import java.util.Optional;

/**
 * Finds the cells a player can stand in and connects them. A cell is a node when a player fits (it
 * and the cell above are passable) and something holds them: a standable block below, a ladder in
 * the cell, or water to swim in.
 */
final class NavGraphBuilder {

  private static final int[][] DIRECTIONS = {
    {1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, 1}, {1, -1}, {-1, 1}, {-1, -1}
  };

  private final BlockClassification blocks;
  private final GridBounds bounds;
  private final int[] nodeOfCell;
  private final List<Integer> cellOfNode = new ArrayList<>();
  private final WaterTopology water;
  private final FlightCorridor flights;

  private NavGraphBuilder(BlockClassification blocks, NavSites sites) {
    this.blocks = blocks;
    this.bounds = blocks.bounds();
    this.nodeOfCell = new int[bounds.volume()];
    Arrays.fill(nodeOfCell, -1);
    water = WaterTopology.build(blocks, sites);
    flights = new FlightCorridor(blocks);
  }

  static NavGraph build(BlockClassification blocks) {
    return build(blocks, new NavSites(List.of(), List.of()));
  }

  static NavGraph build(BlockClassification blocks, NavSites sites) {
    var builder = new NavGraphBuilder(blocks, sites);
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
    if (shape.swim()) return water.node(cell);
    return shape.climbable() || standable(cell.down());
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
    var damage = new ArrayList<Integer>();
    for (var node = 0; node < n; node++) {
      var cell = bounds.cell(cellOfNode.get(node));
      var edges = new ArrayList<Edge>();
      horizontal(cell, edges);
      vertical(cell, edges);
      for (var edge : edges) {
        targets.add(edge.to());
        hops.add(edge.hop());
        costs.add(edge.cost());
        damage.add(edge.damage());
      }
      edgeStart[node + 1] = targets.size();
    }
    var edgeTo = new int[targets.size()];
    var hop = new byte[targets.size()];
    var cost = new float[targets.size()];
    var risk = new int[targets.size()];
    for (var i = 0; i < targets.size(); i++) {
      edgeTo[i] = targets.get(i);
      hop[i] = hops.get(i).code();
      cost[i] = costs.get(i);
      risk[i] = damage.get(i);
    }
    var cells = cellOfNode.stream().mapToInt(Integer::intValue).toArray();
    return new NavGraph(
        bounds,
        new NavGraph.NodeData(
            cells, water.index(cell -> nodeOfCell[cell]), elevations(cells), climbable(cells)),
        new NavGraph.Topology(edgeStart, edgeTo),
        new NavGraph.EdgeData(hop, cost, new EdgeCapabilities(risk, LaunchData.standard(hop))));
  }

  private record Edge(int to, Hop hop, float cost, int damage) {}

  private BitSet climbable(int[] cells) {
    var result = new BitSet(cells.length);
    for (var node = 0; node < cells.length; node++)
      result.set(node, shape(bounds.cell(cells[node])).climbable());
    return result;
  }

  private byte[] elevations(int[] cells) {
    var result = new byte[cells.length];
    for (var node = 0; node < cells.length; node++)
      result[node] = BlockFeet.halfOffset(blocks, bounds.cell(cells[node]));
    return result;
  }

  private int fallDepth(BlockPos source, BlockPos target) {
    return Math.max(
        0, (int) Math.ceil(BlockFeet.at(blocks, source).y() - BlockFeet.at(blocks, target).y()));
  }

  private void horizontal(BlockPos cell, List<Edge> edges) {
    for (var d : DIRECTIONS) {
      step(cell, d[0], d[1], edges);
      leap(cell, d[0], d[1], edges);
    }
  }

  /** Walk level, jump up one, or descend a bounded fall along one cardinal direction. */
  private void step(BlockPos cell, int dx, int dz, List<Edge> edges) {
    if (levelStep(cell, dx, dz, edges) || upwardStep(cell, dx, dz, edges)) return;
    var ahead = cell.offset(dx, 0, dz);
    var diagonal = dx != 0 && dz != 0;
    if (!fits(ahead) || (diagonal && !clearCorner(cell, dx, dz))) return;
    descend(cell, ahead, edges);
  }

  private boolean levelStep(BlockPos cell, int dx, int dz, List<Edge> edges) {
    var ahead = cell.offset(dx, 0, dz);
    var level = nodeAt(ahead);
    var diagonal = dx != 0 && dz != 0;
    if (level < 0 || (diagonal && !clearCorner(cell, dx, dz))) return false;
    var swim = shape(cell).swim() || shape(ahead).swim();
    if (diagonal && !fluidCorner(cell, dx, dz)) return true;
    var cost =
        swim
            ? TraversalCosts.swim(cell, ahead)
            : diagonal ? NavGraph.DIAGONAL_COST : NavGraph.WALK_COST;
    edges.add(new Edge(level, swim ? Hop.SWIM : Hop.WALK, cost, 0));
    return true;
  }

  /**
   * A jump onto the node one cell up and across. The rise is measured between the actual feet
   * heights, so a body standing on a bottom slab beneath a full block faces a block and a half,
   * which no unboosted jump reaches; such a step is no edge at all (fjords: bots hopped at a slab
   * for minutes, peaking a few hundredths short of the ledge). A body in a vine or ladder climbs
   * the rest of the way instead (saigon: the vines beside the blue bomb's platform).
   */
  private boolean upwardStep(BlockPos cell, int dx, int dz, List<Edge> edges) {
    var ahead = cell.offset(dx, 0, dz);
    var diagonal = dx != 0 && dz != 0;
    var up = nodeAt(ahead.up());
    if (up < 0 || !passable(cell.offset(0, 2, 0)) || (diagonal && !clearCorner(cell.up(), dx, dz)))
      return false;
    var swim = shape(cell).swim() || shape(ahead.up()).swim();
    if (swim) {
      edges.add(new Edge(up, Hop.SWIM, TraversalCosts.swim(cell, ahead.up()), 0));
      return true;
    }
    var rise = BlockFeet.at(blocks, ahead.up()).y() - BlockFeet.at(blocks, cell).y();
    if (rise > NavGraph.MAX_JUMP_RISE && !shape(cell).climbable()) return false;
    edges.add(new Edge(up, Hop.JUMP, NavGraph.JUMP_COST, 0));
    return true;
  }

  private boolean fluidCorner(BlockPos cell, int dx, int dz) {
    return !(shape(cell).swim() && shape(cell.offset(dx, 0, dz)).swim())
        || (shape(cell.offset(dx, 0, 0)).swim() && shape(cell.offset(0, 0, dz)).swim());
  }

  private void descend(BlockPos cell, BlockPos ahead, List<Edge> edges) {
    var maximumDepth = cell.y() - bounds.origin().y();
    for (var depth = 1; depth <= maximumDepth; depth++) {
      var below = ahead.offset(0, -depth, 0);
      var landing = nodeAt(below);
      if (landing >= 0) {
        edges.add(descent(cell, below, landing));
        return;
      }
      if (!passable(below)) {
        return;
      }
    }
  }

  private void vertical(BlockPos cell, List<Edge> edges) {
    var shape = shape(cell);
    if (shape.swim()) {
      water.next(cell, true).ifPresent(y -> swimVertical(cell, y, edges));
      water.next(cell, false).ifPresent(y -> swimVertical(cell, y, edges));
    }
    var above = nodeAt(cell.up());
    if (above >= 0 && (shape.climbable() || shape(cell.up()).climbable())) {
      edges.add(new Edge(above, Hop.CLIMB, NavGraph.CLIMB_COST, 0));
    }
    var below = nodeAt(cell.down());
    if (below >= 0 && (shape.climbable() || shape(cell.down()).climbable())) {
      edges.add(new Edge(below, Hop.CLIMB, NavGraph.CLIMB_COST, 0));
    }
  }

  private Edge descent(BlockPos cell, BlockPos below, int landing) {
    var depth = Math.max(1, fallDepth(cell, below));
    var submerged = shape(below).swim();
    var damage = submerged ? 0 : TraversalCosts.fallDamage(depth, false);
    var swimming = shape(cell).swim() && submerged;
    return new Edge(
        landing,
        swimming ? Hop.SWIM : Hop.DROP,
        swimming ? TraversalCosts.swim(cell, below) : TraversalCosts.drop(depth),
        damage);
  }

  private void swimVertical(BlockPos cell, int y, List<Edge> edges) {
    var target = cell.offset(0, y - cell.y(), 0);
    edges.add(new Edge(nodeAt(target), Hop.SWIM, TraversalCosts.swim(cell, target), 0));
  }

  /** Short gaps on the original floating platforms need a sprint jump, sometimes downwards. */
  private void leap(BlockPos cell, int dx, int dz, List<Edge> edges) {
    if (shape(cell).swim() || !standable(cell.down())) return;
    for (var span = 2; span <= 4; span++) {
      for (var descent = -1; descent <= NavGraph.MAX_JUMP_DESCENT; descent++) {
        var landing = cell.offset(dx * span, -descent, dz * span);
        var candidate = leap(cell, landing);
        if (candidate.isPresent()) {
          edges.add(candidate.orElseThrow());
          break;
        }
      }
    }
  }

  private Optional<Edge> leap(BlockPos cell, BlockPos landing) {
    var target = nodeAt(landing);
    if (target < 0 || !(standable(landing.down()) || shape(landing).swim()))
      return Optional.empty();
    var flight = flights.duration(cell, landing);
    if (flight.isEmpty()) return Optional.empty();
    var damage =
        shape(landing).swim() ? 0 : TraversalCosts.fallDamage(fallDepth(cell, landing), true);
    return Optional.of(new Edge(target, Hop.LEAP, flight.orElseThrow(), damage));
  }

  private boolean clearCorner(BlockPos cell, int dx, int dz) {
    return fits(cell.offset(dx, 0, 0)) && fits(cell.offset(0, 0, dz));
  }

  /** Whether a player can be in {@code cell} (it and the cell above are passable). */
  private boolean fits(BlockPos cell) {
    return passable(cell) && passable(cell.up());
  }
}
