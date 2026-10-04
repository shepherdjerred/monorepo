package com.shepherdjerred.thestorm.rwfbots.domain.map;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.function.IntToDoubleFunction;

/**
 * The walkable cells of a map and the typed edges between them, in compressed sparse row form.
 * Nodes are numbered densely; edges carry how the step is made (walk, jump, drop, climb) and what
 * it costs in roughly blocks. A* uses an octile heuristic that never exceeds the real cost, so
 * paths are optimal for the given penalty.
 */
public final class NavGraph {

  /** The cost of walking one block. */
  public static final float WALK_COST = 1f;

  /** The cost of a diagonal walk. */
  public static final float DIAGONAL_COST = 1.41421f;

  /** The cost of stepping up one block. */
  public static final float JUMP_COST = 2f;

  /** The cost of climbing one block of ladder. */
  public static final float CLIMB_COST = 1.5f;

  /** The deepest drop a path may take. */
  public static final int MAX_DROP = 3;

  private static final float INF = Float.POSITIVE_INFINITY;

  private final GridBounds bounds;
  private final int[] cellOfNode;
  private final int[] nodeOfCell;
  private final int[] edgeStart;
  private final int[] edgeTo;
  private final byte[] edgeHop;
  private final float[] edgeCost;
  private final int[] reverseStart;
  private final int[] reverseEdge;

  /**
   * @param bounds the cuboid the cells live in
   * @param cellOfNode the dense cell index of each node
   * @param topology the row starts and edge targets
   * @param edges each edge's hop and cost
   */
  public NavGraph(GridBounds bounds, int[] cellOfNode, Topology topology, EdgeData edges) {
    this.bounds = bounds;
    this.cellOfNode = cellOfNode.clone();
    this.edgeStart = topology.edgeStart().clone();
    this.edgeTo = topology.edgeTo().clone();
    this.edgeHop = edges.hop().clone();
    this.edgeCost = edges.cost().clone();
    var n = this.cellOfNode.length;
    if (this.edgeStart.length != n + 1
        || this.edgeStart[0] != 0
        || this.edgeStart[n] != this.edgeTo.length
        || this.edgeHop.length != this.edgeTo.length) {
      throw new IllegalArgumentException("inconsistent graph arrays");
    }
    nodeOfCell = indexCells(bounds, this.cellOfNode);
    validateEdges(n);
    reverseStart = new int[n + 1];
    reverseEdge = new int[this.edgeTo.length];
    for (var edge : this.edgeTo) {
      reverseStart[edge + 1]++;
    }
    for (var node = 0; node < n; node++) {
      reverseStart[node + 1] += reverseStart[node];
    }
    var fill = reverseStart.clone();
    for (var node = 0; node < n; node++) {
      for (var edge = this.edgeStart[node]; edge < this.edgeStart[node + 1]; edge++) {
        reverseEdge[fill[this.edgeTo[edge]]++] = edge;
      }
    }
  }

  private static int[] indexCells(GridBounds bounds, int[] cellOfNode) {
    var nodeOfCell = new int[bounds.volume()];
    Arrays.fill(nodeOfCell, -1);
    for (var node = 0; node < cellOfNode.length; node++) {
      var cell = cellOfNode[node];
      if (cell < 0 || cell >= nodeOfCell.length || nodeOfCell[cell] != -1) {
        throw new IllegalArgumentException("bad or duplicate cell for node " + node);
      }
      nodeOfCell[cell] = node;
    }
    return nodeOfCell;
  }

  private void validateEdges(int n) {
    for (var edge = 0; edge < edgeTo.length; edge++) {
      if (edgeTo[edge] < 0 || edgeTo[edge] >= n) {
        throw new IllegalArgumentException("edge " + edge + " points outside the graph");
      }
      Hop.ofCode(edgeHop[edge]);
    }
  }

  /**
   * The compressed sparse rows: {@code edgeStart[node]..edgeStart[node + 1]} index the edges that
   * leave {@code node}, and {@code edgeTo} holds their targets.
   */
  public static final class Topology {
    private final int[] edgeStart;
    private final int[] edgeTo;

    public Topology(int[] edgeStart, int[] edgeTo) {
      this.edgeStart = edgeStart.clone();
      this.edgeTo = edgeTo.clone();
    }

    public int[] edgeStart() {
      return edgeStart.clone();
    }

    public int[] edgeTo() {
      return edgeTo.clone();
    }

    @Override
    public boolean equals(Object other) {
      return other instanceof Topology that
          && Arrays.equals(edgeStart, that.edgeStart)
          && Arrays.equals(edgeTo, that.edgeTo);
    }

    @Override
    public int hashCode() {
      return 31 * Arrays.hashCode(edgeStart) + Arrays.hashCode(edgeTo);
    }
  }

  /** The per-edge hop codes and costs, aligned with the edge targets. */
  public static final class EdgeData {
    private final byte[] hop;
    private final float[] cost;

    public EdgeData(byte[] hop, float[] cost) {
      if (hop.length != cost.length) {
        throw new IllegalArgumentException("hop and cost arrays must align");
      }
      this.hop = hop.clone();
      this.cost = cost.clone();
    }

    public byte[] hop() {
      return hop.clone();
    }

    public float[] cost() {
      return cost.clone();
    }

    @Override
    public boolean equals(Object other) {
      return other instanceof EdgeData that
          && Arrays.equals(hop, that.hop)
          && Arrays.equals(cost, that.cost);
    }

    @Override
    public int hashCode() {
      return 31 * Arrays.hashCode(hop) + Arrays.hashCode(cost);
    }
  }

  public GridBounds bounds() {
    return bounds;
  }

  public int nodeCount() {
    return cellOfNode.length;
  }

  public int edgeCount() {
    return edgeTo.length;
  }

  public BlockPos cell(int node) {
    return bounds.cell(cellOfNode[node]);
  }

  /** The dense cell index of {@code node}. */
  public int cellIndex(int node) {
    return cellOfNode[node];
  }

  /** The feet position in the middle of {@code node}'s cell. */
  public Vec3 feet(int node) {
    return cell(node).feet();
  }

  public OptionalInt nodeAt(BlockPos cell) {
    if (!bounds.contains(cell)) {
      return OptionalInt.empty();
    }
    var node = nodeOfCell[bounds.index(cell)];
    return node < 0 ? OptionalInt.empty() : OptionalInt.of(node);
  }

  /**
   * The node a player at {@code feet} is standing on or nearest to: the feet cell, then the cells
   * just below (for slabs and mid-fall) and above, then the ring around them.
   */
  public OptionalInt nearestNode(Vec3 feet) {
    var base = BlockPos.of(feet.plus(0, 0.001, 0));
    int[][] offsets = {
      {0, 0, 0}, {0, -1, 0}, {0, 1, 0}, {0, -2, 0},
      {1, 0, 0}, {-1, 0, 0}, {0, 0, 1}, {0, 0, -1},
      {1, -1, 0}, {-1, -1, 0}, {0, -1, 1}, {0, -1, -1},
      {1, 1, 0}, {-1, 1, 0}, {0, 1, 1}, {0, 1, -1},
      {1, 0, 1}, {1, 0, -1}, {-1, 0, 1}, {-1, 0, -1}
    };
    for (var offset : offsets) {
      var node = nodeAt(base.offset(offset[0], offset[1], offset[2]));
      if (node.isPresent()) {
        return node;
      }
    }
    return OptionalInt.empty();
  }

  public int edgeStart(int node) {
    return edgeStart[node];
  }

  public int edgeEnd(int node) {
    return edgeStart[node + 1];
  }

  public int edgeTarget(int edge) {
    return edgeTo[edge];
  }

  public Hop edgeHop(int edge) {
    return Hop.ofCode(edgeHop[edge]);
  }

  public float edgeCost(int edge) {
    return edgeCost[edge];
  }

  /** The edges arriving at {@code node}, as edge indices. */
  public int[] incomingEdges(int node) {
    return Arrays.copyOfRange(reverseEdge, reverseStart[node], reverseStart[node + 1]);
  }

  /** The node an edge leaves from, found by binary search over the row starts. */
  public int edgeSource(int edge) {
    var lo = 0;
    var hi = cellOfNode.length - 1;
    while (lo < hi) {
      var mid = (lo + hi + 1) >>> 1;
      if (edgeStart[mid] <= edge) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo;
  }

  /** The neighbours of {@code node}. */
  public List<Integer> neighbors(int node) {
    var out = new ArrayList<Integer>();
    for (var edge = edgeStart[node]; edge < edgeStart[node + 1]; edge++) {
      out.add(edgeTo[edge]);
    }
    return out;
  }

  /** The cheapest path from {@code from} to {@code to}, or empty if none exists. */
  public Optional<NavPath> path(int from, int to) {
    return path(from, to, NavGraph::noPenalty);
  }

  private static double noPenalty(int node) {
    return 0;
  }

  /**
   * The cheapest path from {@code from} to {@code to} where entering each node additionally costs
   * {@code penalty} (non-negative), or empty if none exists.
   */
  public Optional<NavPath> path(int from, int to, IntToDoubleFunction penalty) {
    var search = new Search(cellOfNode.length, to);
    search.g[from] = 0;
    search.open.push(heuristic(from, to), from);
    while (!search.open.isEmpty()) {
      var current = search.open.pop();
      if (current == to) {
        return Optional.of(reconstruct(from, to, search.cameFrom, search.viaEdge));
      }
      if (search.closed[current]) {
        continue;
      }
      search.closed[current] = true;
      for (var edge = edgeStart[current]; edge < edgeStart[current + 1]; edge++) {
        relax(search, current, edge, penalty);
      }
    }
    return Optional.empty();
  }

  private void relax(Search search, int current, int edge, IntToDoubleFunction penalty) {
    var next = edgeTo[edge];
    if (search.closed[next]) {
      return;
    }
    var extra = penalty.applyAsDouble(next);
    if (extra < 0) {
      throw new IllegalArgumentException("penalty must be non-negative");
    }
    var tentative = search.g[current] + edgeCost[edge] + (float) extra;
    if (tentative < search.g[next]) {
      search.g[next] = tentative;
      search.cameFrom[next] = current;
      search.viaEdge[next] = edge;
      search.open.push(tentative + heuristic(cell(next), search.goal), next);
    }
  }

  /** The scratch arrays of one A* run. */
  private final class Search {
    final float[] g;
    final int[] cameFrom;
    final int[] viaEdge;
    final boolean[] closed;
    final MinHeap open = new MinHeap(64);
    final BlockPos goal;

    Search(int n, int to) {
      g = new float[n];
      Arrays.fill(g, INF);
      cameFrom = new int[n];
      Arrays.fill(cameFrom, -1);
      viaEdge = new int[n];
      closed = new boolean[n];
      goal = cell(to);
    }
  }

  private float heuristic(int node, int goal) {
    return heuristic(cell(node), cell(goal));
  }

  private static float heuristic(BlockPos a, BlockPos b) {
    var dx = Math.abs(a.x() - b.x());
    var dz = Math.abs(a.z() - b.z());
    var dy = Math.abs(a.y() - b.y());
    return Math.max(dx, dz) + (DIAGONAL_COST - 1) * Math.min(dx, dz) + dy;
  }

  private NavPath reconstruct(int from, int to, int[] cameFrom, int[] viaEdge) {
    var nodes = new ArrayList<Integer>();
    var hops = new ArrayList<Hop>();
    var cost = 0.0;
    var node = to;
    while (node != from) {
      nodes.add(node);
      var edge = viaEdge[node];
      hops.add(edgeHop(edge));
      cost += edgeCost[edge];
      node = cameFrom[node];
    }
    nodes.add(from);
    hops.add(Hop.WALK);
    var ordered = nodes.reversed();
    var orderedHops = hops.reversed();
    var waypoints = new ArrayList<Waypoint>(ordered.size());
    for (var i = 0; i < ordered.size(); i++) {
      waypoints.add(new Waypoint(feet(ordered.get(i)), orderedHops.get(i)));
    }
    return new NavPath(ordered, waypoints, cost);
  }

  int[] cellOfNodeArray() {
    return cellOfNode.clone();
  }

  Topology topology() {
    return new Topology(edgeStart, edgeTo);
  }

  EdgeData edgeData() {
    return new EdgeData(edgeHop, edgeCost);
  }

  @Override
  public boolean equals(Object other) {
    return other instanceof NavGraph that
        && bounds.equals(that.bounds)
        && Arrays.equals(cellOfNode, that.cellOfNode)
        && Arrays.equals(edgeStart, that.edgeStart)
        && Arrays.equals(edgeTo, that.edgeTo)
        && Arrays.equals(edgeHop, that.edgeHop)
        && Arrays.equals(edgeCost, that.edgeCost);
  }

  @Override
  public int hashCode() {
    return Arrays.hashCode(new int[] {bounds.hashCode(), Arrays.hashCode(cellOfNode)});
  }

  @Override
  public String toString() {
    return "NavGraph[" + nodeCount() + " nodes, " + edgeCount() + " edges]";
  }
}
