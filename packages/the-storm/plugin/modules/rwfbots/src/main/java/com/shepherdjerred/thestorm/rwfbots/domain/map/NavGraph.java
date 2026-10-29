package com.shepherdjerred.thestorm.rwfbots.domain.map;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementSafety;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.BitSet;
import java.util.List;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLongArray;
import java.util.function.IntPredicate;
import java.util.function.IntToDoubleFunction;
import java.util.function.Supplier;

/**
 * The walkable cells of a map and the typed edges between them, in compressed sparse row form.
 * Nodes are numbered densely; edges carry how the step is made (walk, jump, drop, climb) and what
 * it costs in server ticks. A* uses a graph-calibrated admissible octile heuristic, so paths are
 * optimal for the given penalty.
 */
public final class NavGraph {

  /** The cost of walking one block. */
  public static final float WALK_COST = TraversalCosts.WALK;

  /** The cost of a diagonal walk. */
  public static final float DIAGONAL_COST = TraversalCosts.DIAGONAL;

  /** The cost of stepping up one block. */
  public static final float JUMP_COST = TraversalCosts.STEP_JUMP;

  /** The cost of climbing one block of ladder. */
  public static final float CLIMB_COST = TraversalCosts.CLIMB;

  /** Sprint-jump flight certification is bounded independently of full-height walk-off drops. */
  public static final int MAX_JUMP_DESCENT = 16;

  /**
   * The highest rise between feet heights a jump edge may climb: the apex of a jump without Jump
   * Boost. The graph is shared by every body, so it only offers what an unboosted body can make.
   */
  public static final double MAX_JUMP_RISE = MovementSafety.jumpRise(MovementSafety.NO_JUMP_BOOST);

  private static final float INF = Float.POSITIVE_INFINITY;
  private static final int[][] NEAREST_OFFSETS = {
    {0, 0, 0}, {0, -1, 0}, {0, 1, 0}, {0, -2, 0},
    {1, 0, 0}, {-1, 0, 0}, {0, 0, 1}, {0, 0, -1},
    {1, -1, 0}, {-1, -1, 0}, {0, -1, 1}, {0, -1, -1},
    {1, 1, 0}, {-1, 1, 0}, {0, 1, 1}, {0, 1, -1},
    {1, 0, 1}, {1, 0, -1}, {-1, 0, 1}, {-1, 0, -1}
  };

  private final GridBounds bounds;
  private final int[] cellOfNode;
  private final byte[] halfHeight;
  private final BitSet climbable;
  private final int[] nodeOfCell;
  private final int[] edgeStart;
  private final int[] edgeTo;
  private final byte[] edgeHop;
  private final float[] edgeCost;
  private final EdgeCapabilities capabilities;
  private final AtomicLongArray runUpDistances;
  private final BitSet unheldClimbDiagonals;
  private final WaterIndex water;
  private final float heuristicScale;
  private final int[] reverseStart;
  private final int[] reverseEdge;
  private final DirectedReachability reachability;

  /** The nodes reaching each {@link #reachesAny} target set. */
  private final AnchorReach anchorReach = new AnchorReach(this);

  /**
   * @param bounds the cuboid the cells live in
   * @param cellOfNode the dense cell index of each node
   * @param topology the row starts and edge targets
   * @param edges each edge's hop and cost
   */
  public NavGraph(GridBounds bounds, int[] cellOfNode, Topology topology, EdgeData edges) {
    this(bounds, new NodeData(cellOfNode, WaterIndex.empty(bounds)), topology, edges);
  }

  /** Node coordinates and compressed submerged-cell lookup from the same offline bake. */
  public static final class NodeData {
    private final int[] cells;
    private final WaterIndex water;
    private final byte[] halfHeight;
    private final BitSet climbable;

    /** Explicit whole-block node elevations for synthetic graph fixtures. */
    public NodeData(int[] cells, WaterIndex water) {
      this(cells, water, new byte[cells.length]);
    }

    public NodeData(int[] cells, WaterIndex water, byte[] halfHeight) {
      this(cells, water, halfHeight, new BitSet());
    }

    /** Exact occupied-cell climbing capability from the authoritative block classification. */
    public NodeData(int[] cells, WaterIndex water, byte[] halfHeight, BitSet climbable) {
      this.cells = cells.clone();
      this.water = water;
      this.halfHeight = halfHeight.clone();
      this.climbable = (BitSet) climbable.clone();
      if (climbable.length() > cells.length)
        throw new IllegalArgumentException("climb capability extends past graph nodes");
      if (cells.length != halfHeight.length)
        throw new IllegalArgumentException("node elevations do not align");
      for (var value : halfHeight)
        if (value != 0 && value != -1)
          throw new IllegalArgumentException("unknown node half-block elevation");
    }

    public int[] cells() {
      return cells.clone();
    }

    public WaterIndex water() {
      return water;
    }

    public byte[] halfHeight() {
      return halfHeight.clone();
    }

    public BitSet climbable() {
      return (BitSet) climbable.clone();
    }
  }

  public NavGraph(GridBounds bounds, NodeData nodes, Topology topology, EdgeData edges) {
    this.bounds = bounds;
    this.cellOfNode = nodes.cells();
    this.halfHeight = nodes.halfHeight();
    this.climbable = nodes.climbable();
    this.edgeStart = topology.edgeStart().clone();
    this.edgeTo = topology.edgeTo().clone();
    this.edgeHop = edges.hop().clone();
    this.edgeCost = edges.cost().clone();
    capabilities = edges.capabilities();
    runUpDistances = new AtomicLongArray(capabilities.launch().size());
    water = nodes.water();
    if (!bounds.equals(water.bounds()))
      throw new IllegalArgumentException("water index bounds differ from graph");
    var n = this.cellOfNode.length;
    if (this.edgeStart.length != n + 1
        || this.edgeStart[0] != 0
        || this.edgeStart[n] != this.edgeTo.length
        || this.edgeHop.length != this.edgeTo.length
        || capabilities.damage().length != this.edgeTo.length) {
      throw new IllegalArgumentException("inconsistent graph arrays");
    }
    nodeOfCell = indexCells(bounds, this.cellOfNode);
    validateEdges(n);
    capabilities.launch().validate(edgeHop);
    water.validateNodes(this::cell, n);
    heuristicScale = minimumMetricCost();
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
    unheldClimbDiagonals = unheldClimbDiagonals(n);
    reachability = new DirectedReachability(this);
  }

  /**
   * Level diagonal walks between two climbable cells (two ladders in a shaft, a vine round a
   * pillar) whose corner cells hold nothing up: a body leaving its ladder through such a corner
   * falls, so the walk cannot be followed. Found once from the graph; the baked artifact is
   * unchanged.
   */
  private BitSet unheldClimbDiagonals(int nodes) {
    var unheld = new BitSet(edgeTo.length);
    for (var node = climbable.nextSetBit(0);
        node >= 0 && node < nodes;
        node = climbable.nextSetBit(node + 1)) {
      for (var edge = edgeStart[node]; edge < edgeStart[node + 1]; edge++) {
        if (unheldDiagonal(node, edge)) unheld.set(edge);
      }
    }
    return unheld;
  }

  private boolean unheldDiagonal(int node, int edge) {
    var target = edgeTo[edge];
    if (Hop.ofCode(edgeHop[edge]) != Hop.WALK || !climbable.get(target)) return false;
    var from = cell(node);
    var to = cell(target);
    var dx = to.x() - from.x();
    var dz = to.z() - from.z();
    if (dx == 0 || dz == 0 || to.y() != from.y()) return false;
    return nodeAt(from.offset(dx, 0, 0)).isEmpty() || nodeAt(from.offset(0, 0, dz)).isEmpty();
  }

  /**
   * Whether {@code edge} is a level diagonal between climbables through a corner holding nothing.
   */
  public boolean unheldClimbDiagonal(int edge) {
    return unheldClimbDiagonals.get(edge);
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
    for (var node = 0; node < n; node++) {
      if (edgeStart[node] < 0 || edgeStart[node] > edgeStart[node + 1]) {
        throw new IllegalArgumentException("invalid graph row starts");
      }
    }
    for (var edge = 0; edge < edgeTo.length; edge++) {
      if (edgeTo[edge] < 0 || edgeTo[edge] >= n) {
        throw new IllegalArgumentException("edge " + edge + " points outside the graph");
      }
      if (!Float.isFinite(edgeCost[edge]) || edgeCost[edge] < 0) {
        throw new IllegalArgumentException("edge costs must be finite and non-negative");
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
    private final EdgeCapabilities capabilities;

    public EdgeData(byte[] hop, float[] cost) {
      this(hop, cost, EdgeCapabilities.standard(hop));
    }

    public EdgeData(byte[] hop, float[] cost, EdgeCapabilities capabilities) {
      if (hop.length != cost.length) {
        throw new IllegalArgumentException("hop and cost arrays must align");
      }
      this.hop = hop.clone();
      this.cost = cost.clone();
      this.capabilities = capabilities;
    }

    public byte[] hop() {
      return hop.clone();
    }

    public float[] cost() {
      return cost.clone();
    }

    public EdgeCapabilities capabilities() {
      return capabilities;
    }

    @Override
    public boolean equals(Object other) {
      return other instanceof EdgeData that
          && Arrays.equals(hop, that.hop)
          && Arrays.equals(cost, that.cost)
          && capabilities.equals(that.capabilities);
    }

    @Override
    public int hashCode() {
      return 31 * (31 * Arrays.hashCode(hop) + Arrays.hashCode(cost)) + capabilities.hashCode();
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
    return cell(node).feet().plus(0, halfHeight[node] * 0.5, 0);
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
    var submerged = water.nearest(base);
    if (submerged.isPresent()) return submerged;
    for (var offset : NEAREST_OFFSETS) {
      var node = nodeAt(base.offset(offset[0], offset[1], offset[2]));
      if (node.isPresent()) {
        return node;
      }
    }
    return OptionalInt.empty();
  }

  /**
   * The walkable node whose feet are horizontally nearest {@code point}, looking up to {@code
   * radius} blocks around it and three blocks up or down; empty when none is that close.
   */
  public OptionalInt nearestNodeWithin(Vec3 point, int radius) {
    var base = BlockPos.of(point.plus(0, 0.001, 0));
    var best = -1;
    var bestDistance = Double.POSITIVE_INFINITY;
    for (var dx = -radius; dx <= radius; dx++) {
      for (var dz = -radius; dz <= radius; dz++) {
        var column = nearestInColumn(base.offset(dx, 0, dz), point);
        if (column >= 0 && snapDistance(column, point) < bestDistance) {
          bestDistance = snapDistance(column, point);
          best = column;
        }
      }
    }
    return best < 0 ? OptionalInt.empty() : OptionalInt.of(best);
  }

  /** The node within three blocks up or down of {@code cell} nearest {@code point}, or -1. */
  private int nearestInColumn(BlockPos cell, Vec3 point) {
    var best = -1;
    for (var dy = -3; dy <= 3; dy++) {
      var node = nodeAt(cell.offset(0, dy, 0));
      if (node.isPresent()
          && (best < 0 || snapDistance(node.getAsInt(), point) < snapDistance(best, point))) {
        best = node.getAsInt();
      }
    }
    return best;
  }

  /** Horizontal distance from {@code node}'s feet to {@code point}, with height as a tie-break. */
  private double snapDistance(int node, Vec3 point) {
    var feet = feet(node);
    return feet.horizontalDistance(point) + 0.01 * Math.abs(feet.y() - point.y());
  }

  /** Exact directed connectivity, independent of edge weights or a route search. */
  public boolean reachable(int from, int to) {
    requireNode(from);
    requireNode(to);
    return reachability.reaches(from, to);
  }

  /**
   * Whether some node of {@code targets} can be reached from {@code from} over the edges a body
   * takes: every edge, or every edge but a sprint jump for a body that may not sprint. The nodes
   * reaching them are found once per {@code key}, which must name the same targets every time (a
   * map's sites, for their approach nodes). No targets at all leave every node free to go anywhere.
   */
  public boolean reachesAny(int from, Object key, Supplier<int[]> targets, boolean leaps) {
    requireNode(from);
    return reaching(key, targets, leaps).test(from);
  }

  /** {@link #reachesAny} for every node at once, for a search that asks it of each edge. */
  public IntPredicate reaching(Object key, Supplier<int[]> targets, boolean leaps) {
    return anchorReach.reaching(key, targets, leaps);
  }

  /** Nodes reachable from every supplied source; an empty source list imposes no restriction. */
  public BitSet reachableFromAll(int[] sources) {
    for (var source : sources) requireNode(source);
    return reachability.commonFrom(sources);
  }

  private void requireNode(int node) {
    if (node < 0 || node >= nodeCount())
      throw new IllegalArgumentException("invalid reachability node");
  }

  /** The path cost from {@code from} to every node, infinite where unreachable (Dijkstra). */
  public float[] costsFrom(int from) {
    var cost = new float[cellOfNode.length];
    Arrays.fill(cost, INF);
    var settled = new boolean[cellOfNode.length];
    var open = new MinHeap(64);
    cost[from] = 0;
    open.push(0, from);
    while (!open.isEmpty()) {
      var node = open.pop();
      if (settled[node]) {
        continue;
      }
      settled[node] = true;
      for (var edge = edgeStart[node]; edge < edgeStart[node + 1]; edge++) {
        var next = edgeTo[edge];
        var through = cost[node] + edgeCost[edge];
        if (through < cost[next]) {
          cost[next] = through;
          open.push(through, next);
        }
      }
    }
    return cost;
  }

  /** Exact directed distances to the requested nodes; -1 denotes an unresolved target. */
  public float[] costsToTargets(int from, int[] targets, SearchWorkspace workspace) {
    workspace.acquire(cellOfNode.length);
    try {
      var wanted = targets(targets);
      var remaining = wanted.cardinality();
      workspace.g[from] = 0;
      workspace.open.push(0, from);
      while (!workspace.open.isEmpty() && remaining > 0) {
        var node = workspace.open.pop();
        if (workspace.closed[node]) continue;
        workspace.closed[node] = true;
        if (wanted.get(node)) remaining--;
        for (var edge = edgeStart[node]; edge < edgeStart[node + 1]; edge++) {
          var next = edgeTo[edge];
          var through = workspace.g[node] + edgeCost[edge];
          if (through < workspace.g[next]) {
            workspace.g[next] = through;
            workspace.open.push(through, next);
          }
        }
      }
      var result = new float[targets.length];
      for (var i = 0; i < targets.length; i++) {
        result[i] = targets[i] == -1 ? INF : workspace.g[targets[i]];
      }
      return result;
    } finally {
      workspace.release();
    }
  }

  private BitSet targets(int[] nodes) {
    var result = new BitSet(cellOfNode.length);
    for (var node : nodes) {
      if (node < -1 || node >= cellOfNode.length)
        throw new IllegalArgumentException("invalid target node");
      if (node >= 0) result.set(node);
    }
    return result;
  }

  /**
   * Exact forward distances clipped at a finite non-negative cap. Unreachable or missing targets
   * stay infinite, including when the search stops before their reachable alternatives settle.
   */
  public float[] cappedCostsToTargets(
      int from, int[] targets, float cap, SearchWorkspace workspace) {
    if (from < 0 || from >= nodeCount()) throw new IllegalArgumentException("invalid source node");
    if (!Float.isFinite(cap) || cap < 0) throw new IllegalArgumentException("invalid distance cap");
    workspace.acquire(cellOfNode.length);
    try {
      var wanted = reachableTargets(from, targets, workspace);
      searchToCap(from, wanted, cap, workspace);
      var result = new float[targets.length];
      for (var i = 0; i < targets.length; i++) {
        result[i] =
            targets[i] >= 0 && wanted.get(targets[i])
                ? Math.min(cap, workspace.g[targets[i]])
                : INF;
      }
      return result;
    } finally {
      workspace.release();
    }
  }

  private BitSet reachableTargets(int from, int[] targets, SearchWorkspace workspace) {
    var wanted = targets(targets);
    var reachable = reachability.from(from, workspace.reachable, workspace.cameFrom);
    for (var target = wanted.nextSetBit(0); target >= 0; target = wanted.nextSetBit(target + 1)) {
      if (!reachable.get(reachability.componentOf(target))) wanted.clear(target);
    }
    return wanted;
  }

  private void searchToCap(int from, BitSet wanted, float cap, SearchWorkspace workspace) {
    var remaining = wanted.cardinality();
    workspace.g[from] = 0;
    workspace.open.push(0, from);
    while (!workspace.open.isEmpty() && remaining > 0 && workspace.open.peekKey() < cap) {
      var node = workspace.open.pop();
      if (workspace.closed[node]) continue;
      workspace.closed[node] = true;
      if (wanted.get(node)) remaining--;
      relaxCapped(node, cap, workspace);
    }
  }

  private void relaxCapped(int node, float cap, SearchWorkspace workspace) {
    for (var edge = edgeStart[node]; edge < edgeStart[node + 1]; edge++) {
      var next = edgeTo[edge];
      var through = workspace.g[node] + edgeCost[edge];
      if (through < workspace.g[next] && through < cap) {
        workspace.g[next] = through;
        workspace.open.push(through, next);
      }
    }
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

  public int edgeDamage(int edge) {
    return capabilities.damage(edge);
  }

  public WaterIndex water() {
    return water;
  }

  /**
   * Whether water breaks a fall onto {@code cell}: it is submerged and no cell around it is a rim,
   * a dry block a body can stand on top of. Its top is above the water's surface, so a body coming
   * down into a one-block irrigation hole lands on the rim instead (beanstalk: bots dropped 22
   * blocks into one and lost 19 health). A wall is no rim.
   */
  public boolean cushions(BlockPos cell) {
    if (!water.contains(cell)) return false;
    for (var dx = -1; dx <= 1; dx++) {
      for (var dz = -1; dz <= 1; dz++) {
        var beside = cell.offset(dx, 0, dz);
        if (!water.contains(beside) && nodeAt(beside.up()).isPresent()) return false;
      }
    }
    return true;
  }

  /** Reconstructs the complete baked primitive, including its launch/run-up prerequisite. */
  public Waypoint waypoint(int edge) {
    return waypoint(edge, edgeSource(edge));
  }

  /** Reuses a known CSR source without searching for the edge's row a second time. */
  public Waypoint waypoint(int edge, int source) {
    if (!edgeLeaves(edge, source))
      throw new IllegalArgumentException("edge does not leave the supplied node");
    var from = feet(source);
    var to = feet(edgeTarget(edge));
    // A fall lands in water only where the water breaks it; a swim or a climb wherever it is.
    var falls = edgeHop(edge) == Hop.DROP || edgeHop(edge) == Hop.LEAP;
    var wet = falls ? cushions(BlockPos.of(to)) : water.contains(BlockPos.of(to));
    var landing =
        wet
            ? Waypoint.Landing.WATER
            : edgeHop(edge) == Hop.CLIMB ? Waypoint.Landing.CLIMB : Waypoint.Landing.GROUND;
    return new Waypoint(
        to, edgeHop(edge), capabilities.launch().launch(edge, from, to, edgeCost(edge)), landing);
  }

  /** Membership in one known CSR row; an unknown source cannot own an edge. */
  public boolean edgeLeaves(int edge, int source) {
    return source >= 0
        && source < nodeCount()
        && edge >= edgeStart[source]
        && edge < edgeStart[source + 1];
  }

  /**
   * Caches the exact reconstructed horizontal distance for each sparse LEAP row. The geometric
   * result may differ in its last bits from the baked run-up scalar, so it is never substituted.
   */
  public double runUpDistance(int edge) {
    var index = capabilities.launch().indexOf(edge);
    if (index < 0) throw new IllegalArgumentException("edge has no sprint-jump launch");
    var known = runUpDistances.get(index);
    if (known != 0) return Double.longBitsToDouble(known);
    var launch = waypoint(edge).launch().orElseThrow();
    var distance = launch.takeoff().horizontalDistance(launch.runUpStart());
    // JumpLaunch requires at least half a block, so zero bits unambiguously mean uninitialized.
    runUpDistances.compareAndSet(index, 0, Double.doubleToRawLongBits(distance));
    return distance;
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
    return path(from, to, penalty, workspace());
  }

  /** An exclusively owned, reusable workspace; it retains arrays, never graph or map assets. */
  public SearchWorkspace workspace() {
    return new SearchWorkspace(cellOfNode.length);
  }

  /** Finds the same path while reusing scratch arrays; overlapping workspace use is rejected. */
  public Optional<NavPath> path(
      int from, int to, IntToDoubleFunction penalty, SearchWorkspace workspace) {
    return path(
        from,
        to,
        new PathWeights(
            penalty, NavGraph::noPenalty, new EdgeMotion(this::edgeCost, edge -> true, 1)),
        workspace);
  }

  /** Independent non-negative node/edge tolls, both in server ticks. */
  public record EdgeMotion(
      IntToDoubleFunction duration, IntPredicate allowed, double heuristicRatio) {
    public EdgeMotion {
      if (!Double.isFinite(heuristicRatio) || heuristicRatio < 0 || heuristicRatio > 1)
        throw new IllegalArgumentException("motion heuristic ratio must be in[0,1]");
    }
  }

  @FunctionalInterface
  public interface EdgeToll {
    double cost(int edge, int source, double physicalDuration);
  }

  public record PathWeights(IntToDoubleFunction node, EdgeToll edge, EdgeMotion motion) {
    public PathWeights(IntToDoubleFunction node, IntToDoubleFunction edge, EdgeMotion motion) {
      this(node, (index, source, duration) -> edge.applyAsDouble(index), motion);
    }
  }

  public record WeightedPath(NavPath path, double weightedCost) {}

  /** Keeps exact selected-edge discretionary costs separate from physical route time. */
  public Optional<WeightedPath> weightedPath(
      int from, int to, PathWeights weights, SearchWorkspace workspace) {
    workspace.acquire(cellOfNode.length);
    try {
      return search(from, to, weights, workspace)
          .map(path -> new WeightedPath(path, weightedCost(from, to, weights, workspace)));
    } finally {
      workspace.release();
    }
  }

  private double weightedCost(int from, int to, PathWeights weights, SearchWorkspace scratch) {
    var cost = 0.0;
    for (var node = to; node != from; node = scratch.cameFrom[node]) {
      var edge = scratch.viaEdge[node];
      var duration = weights.motion().duration().applyAsDouble(edge);
      cost +=
          duration
              + weights.node().applyAsDouble(node)
              + weights.edge().cost(edge, scratch.cameFrom[node], duration);
    }
    return cost;
  }

  public Optional<NavPath> path(int from, int to, PathWeights weights, SearchWorkspace workspace) {
    workspace.acquire(cellOfNode.length);
    try {
      return search(from, to, weights, workspace);
    } finally {
      workspace.release();
    }
  }

  private Optional<NavPath> search(
      int from, int to, PathWeights weights, SearchWorkspace workspace) {
    var search = new Search(workspace, to, weights.motion().heuristicRatio());
    search.g[from] = 0;
    search.open.push((float) (heuristic(from, to) * search.heuristicRatio), from);
    while (!search.open.isEmpty()) {
      var current = search.open.pop();
      if (current == to) {
        return Optional.of(reconstruct(from, to, search, weights.motion()));
      }
      if (search.closed[current]) {
        continue;
      }
      search.closed[current] = true;
      for (var edge = edgeStart[current]; edge < edgeStart[current + 1]; edge++) {
        relax(search, current, edge, weights);
      }
    }
    return Optional.empty();
  }

  private void relax(Search search, int current, int edge, PathWeights weights) {
    if (!weights.motion().allowed().test(edge)) return;
    var next = edgeTo[edge];
    if (search.closed[next]) {
      return;
    }
    var duration = weights.motion().duration().applyAsDouble(edge);
    if (!Double.isFinite(duration) || duration < 0)
      throw new IllegalArgumentException("motion duration must be finite and non-negative");
    var nodePenalty = weights.node().applyAsDouble(next);
    var edgePenalty = weights.edge().cost(edge, current, duration);
    if (!Double.isFinite(nodePenalty)
        || nodePenalty < 0
        || !Double.isFinite(edgePenalty)
        || edgePenalty < 0) {
      throw new IllegalArgumentException("penalties must be finite and non-negative");
    }
    var extra = nodePenalty + edgePenalty;
    var tentative = search.g[current] + (float) duration + (float) extra;
    if (tentative < search.g[next]) {
      search.g[next] = tentative;
      search.cameFrom[next] = current;
      search.viaEdge[next] = edge;
      search.open.push(
          (float) (tentative + heuristic(cell(next), search.goal) * search.heuristicRatio), next);
    }
  }

  /** Arrays and heap owned by one batch, reused only after the previous search has finished. */
  public static final class SearchWorkspace {
    private final float[] g;
    private final int[] cameFrom;
    private final int[] viaEdge;
    private final boolean[] closed;
    private final MinHeap open = new MinHeap(64);
    private final AtomicBoolean inUse = new AtomicBoolean();
    private final BitSet reachable = new BitSet();

    private SearchWorkspace(int size) {
      g = new float[size];
      cameFrom = new int[size];
      viaEdge = new int[size];
      closed = new boolean[size];
    }

    private void acquire(int size) {
      if (size != g.length)
        throw new IllegalArgumentException("workspace belongs to another graph size");
      if (!inUse.compareAndSet(false, true))
        throw new IllegalStateException("workspace already in use");
      Arrays.fill(g, INF);
      // Each reached node gets its parent before entering the heap. Reconstruction stops at
      // the source; the reachability traversal also overwrites its stack before reading it.
      Arrays.fill(closed, false);
      open.clear();
    }

    private void release() {
      inUse.set(false);
    }
  }

  /** A search's goal and borrowed scratch arrays. */
  private final class Search {
    final float[] g;
    final int[] cameFrom;
    final int[] viaEdge;
    final boolean[] closed;
    final MinHeap open;
    final BlockPos goal;
    final double heuristicRatio;

    Search(SearchWorkspace workspace, int to, double heuristicRatio) {
      g = workspace.g;
      cameFrom = workspace.cameFrom;
      viaEdge = workspace.viaEdge;
      closed = workspace.closed;
      open = workspace.open;
      goal = cell(to);
      this.heuristicRatio = heuristicRatio;
    }
  }

  private float heuristic(int node, int goal) {
    return heuristic(cell(node), cell(goal));
  }

  private float heuristic(BlockPos a, BlockPos b) {
    return heuristicScale * metric(a, b);
  }

  private static float metric(BlockPos a, BlockPos b) {
    var dx = Math.abs(a.x() - b.x());
    var dz = Math.abs(a.z() - b.z());
    var dy = Math.abs(a.y() - b.y());
    return Math.max(dx, dz) + (1.41421f - 1) * Math.min(dx, dz) + dy;
  }

  private float minimumMetricCost() {
    var scale = Float.POSITIVE_INFINITY;
    for (var node = 0; node < nodeCount(); node++) {
      for (var edge = edgeStart[node]; edge < edgeStart[node + 1]; edge++) {
        var distance = metric(cell(node), cell(edgeTo[edge]));
        if (distance > 0) scale = Math.min(scale, edgeCost[edge] / distance);
      }
    }
    return Float.isFinite(scale) ? scale : 0;
  }

  private NavPath reconstruct(int from, int to, Search search, EdgeMotion motion) {
    var cameFrom = search.cameFrom;
    var viaEdge = search.viaEdge;
    var length = 1;
    for (var node = to; node != from; node = cameFrom[node]) {
      length++;
    }
    var nodes = new Integer[length];
    var waypoints = new Waypoint[length];
    var cost = 0.0;
    var node = to;
    var index = length - 1;
    while (node != from) {
      var edge = viaEdge[node];
      nodes[index] = node;
      waypoints[index] = waypoint(edge);
      cost += motion.duration().applyAsDouble(edge);
      node = cameFrom[node];
      index--;
    }
    nodes[0] = from;
    waypoints[0] = new Waypoint(feet(from), Hop.WALK);
    return new NavPath(List.of(nodes), List.of(waypoints), cost);
  }

  int[] cellOfNodeArray() {
    return cellOfNode.clone();
  }

  Topology topology() {
    return new Topology(edgeStart, edgeTo);
  }

  EdgeData edgeData() {
    return new EdgeData(edgeHop, edgeCost, capabilities);
  }

  NodeData nodeData() {
    return new NodeData(cellOfNode, water, halfHeight, climbable);
  }

  /** Whether the feet cell itself is climbable, rather than merely adjacent to a climb edge. */
  public boolean climbable(int node) {
    requireNode(node);
    return climbable.get(node);
  }

  public BitSet climbableNodes() {
    return (BitSet) climbable.clone();
  }

  byte[] halfHeightArray() {
    return halfHeight.clone();
  }

  @Override
  public boolean equals(Object other) {
    return other instanceof NavGraph that
        && bounds.equals(that.bounds)
        && Arrays.equals(cellOfNode, that.cellOfNode)
        && Arrays.equals(halfHeight, that.halfHeight)
        && climbable.equals(that.climbable)
        && Arrays.equals(edgeStart, that.edgeStart)
        && Arrays.equals(edgeTo, that.edgeTo)
        && Arrays.equals(edgeHop, that.edgeHop)
        && Arrays.equals(edgeCost, that.edgeCost)
        && capabilities.equals(that.capabilities)
        && water.equals(that.water);
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
