package com.shepherdjerred.thestorm.rwfbots.domain.map;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Optional;
import java.util.OptionalInt;
import java.util.function.IntFunction;

/** Compact immutable lookup from any submerged cell to a reachable same-column portal node. */
public final class WaterIndex {
  private static final int[][] DIRECTIONS = {
    {1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, 1}, {1, -1}, {-1, 1}, {-1, -1}
  };
  private final GridBounds bounds;
  private final int[] columns;
  private final Intervals intervals;
  private final Portals portals;
  private final List<ColumnInterval> volumes;
  private final List<List<ColumnInterval>> adjacency;
  private final int[] criticalHeights;

  /** Parallel interval bounds and compressed-row starts into the portal arrays. */
  public static final class Intervals {
    private final int[] low;
    private final int[] high;
    private final int[] start;

    public Intervals(int[] low, int[] high, int[] start) {
      this.low = low.clone();
      this.high = high.clone();
      this.start = start.clone();
      if (low.length != high.length || start.length != low.length + 1 || start[0] != 0)
        throw new IllegalArgumentException("water interval arrays differ");
    }

    public int[] low() {
      return low.clone();
    }

    public int[] high() {
      return high.clone();
    }

    public int[] start() {
      return start.clone();
    }
  }

  /** Portal node ids and their vertical coordinates, sorted within each interval. */
  public static final class Portals {
    private final int[] nodes;
    private final int[] heights;

    public Portals(int[] nodes, int[] heights) {
      this.nodes = nodes.clone();
      this.heights = heights.clone();
      if (nodes.length != heights.length)
        throw new IllegalArgumentException("water portal arrays differ");
    }

    public int[] nodes() {
      return nodes.clone();
    }

    public int[] heights() {
      return heights.clone();
    }
  }

  public WaterIndex(GridBounds bounds, int[] columns, Intervals intervals, Portals portals) {
    this.bounds = bounds;
    this.columns = columns.clone();
    this.intervals = intervals;
    this.portals = portals;
    if (columns.length != bounds.sizeX() * bounds.sizeZ() + 1
        || columns[0] != 0
        || columns[columns.length - 1] != intervals.low.length
        || intervals.start[intervals.start.length - 1] != portals.nodes.length)
      throw new IllegalArgumentException("water index row lengths differ");
    validateRows();
    criticalHeights = Arrays.stream(portals.heights).distinct().sorted().toArray();
    volumes = volumes();
    var neighbors = new ArrayList<List<ColumnInterval>>(volumes.size());
    for (var id = 0; id < volumes.size(); id++) neighbors.add(neighborsOf(id));
    adjacency = List.copyOf(neighbors);
  }

  public static WaterIndex empty(GridBounds bounds) {
    return new WaterIndex(
        bounds,
        new int[bounds.sizeX() * bounds.sizeZ() + 1],
        new Intervals(new int[0], new int[0], new int[] {0}),
        new Portals(new int[0], new int[0]));
  }

  public int[] columns() {
    return columns.clone();
  }

  public Intervals intervals() {
    return intervals;
  }

  public Portals portals() {
    return portals;
  }

  private void validateRows() {
    for (var column = 0; column < columns.length - 1; column++) {
      if (columns[column] < 0
          || columns[column] > columns[column + 1]
          || columns[column + 1] > intervals.low.length)
        throw new IllegalArgumentException("water columns are not ordered");
    }
    for (var column = 0; column < columns.length - 1; column++) {
      var previous = bounds.origin().y() - 1;
      for (var interval = columns[column]; interval < columns[column + 1]; interval++) {
        if (intervals.low[interval] <= previous
            || intervals.low[interval] > intervals.high[interval]
            || intervals.high[interval] >= bounds.origin().y() + bounds.sizeY())
          throw new IllegalArgumentException("water intervals overlap or leave bounds");
        validatePortals(interval);
        previous = intervals.high[interval];
      }
    }
  }

  private void validatePortals(int interval) {
    var first = intervals.start[interval];
    var end = intervals.start[interval + 1];
    if (first < 0 || first >= end || end > portals.nodes.length)
      throw new IllegalArgumentException("water interval has no ordered portals");
    var previous = intervals.low[interval] - 1;
    for (var portal = first; portal < end; portal++) {
      var height = portals.heights[portal];
      if (portals.nodes[portal] < 0 || height <= previous || height > intervals.high[interval])
        throw new IllegalArgumentException("water portal is invalid");
      previous = height;
    }
    if (portals.heights[first] != intervals.low[interval]
        || portals.heights[end - 1] != intervals.high[interval])
      throw new IllegalArgumentException("water interval endpoints must be retained");
  }

  public void validateNodes(IntFunction<BlockPos> cells, int count) {
    for (var column = 0; column < columns.length - 1; column++)
      validateColumnNodes(column, cells, count);
  }

  private void validateColumnNodes(int column, IntFunction<BlockPos> cells, int count) {
    for (var interval = columns[column]; interval < columns[column + 1]; interval++) {
      for (var portal = intervals.start[interval];
          portal < intervals.start[interval + 1];
          portal++) {
        var node = portals.nodes[portal];
        if (node >= count) throw new IllegalArgumentException("water portal node outside graph");
        var cell = cells.apply(node);
        if (cell.x() != bounds.origin().x() + column % bounds.sizeX()
            || cell.z() != bounds.origin().z() + column / bounds.sizeX()
            || cell.y() != portals.heights[portal])
          throw new IllegalArgumentException("water portal node coordinate differs");
      }
    }
  }

  public boolean contains(BlockPos cell) {
    return interval(cell) >= 0;
  }

  /** One body-clear fluid column interval, including omitted interior depths. */
  public record ColumnInterval(int id, BlockPos low, int high) {}

  public GridBounds bounds() {
    return bounds;
  }

  public int[] criticalHeights() {
    return criticalHeights.clone();
  }

  public Optional<ColumnInterval> at(BlockPos cell) {
    var id = interval(cell);
    return id < 0 ? Optional.empty() : Optional.of(volume(id));
  }

  public ColumnInterval volume(int id) {
    if (id < 0 || id >= volumes.size())
      throw new IllegalArgumentException("unknown water interval");
    return volumes.get(id);
  }

  private List<ColumnInterval> volumes() {
    var result = new ArrayList<ColumnInterval>(intervals.low.length);
    for (var column = 0; column < columns.length - 1; column++)
      for (var id = columns[column]; id < columns[column + 1]; id++)
        result.add(
            new ColumnInterval(
                id,
                new BlockPos(
                    bounds.origin().x() + column % bounds.sizeX(),
                    intervals.low[id],
                    bounds.origin().z() + column / bounds.sizeX()),
                intervals.high[id]));
    return List.copyOf(result);
  }

  public List<ColumnInterval> neighbors(int id) {
    return adjacency.get(id);
  }

  private List<ColumnInterval> neighborsOf(int id) {
    var own = volume(id);
    var result = new ArrayList<ColumnInterval>();
    for (var direction : DIRECTIONS) {
      var x = own.low().x() - bounds.origin().x() + direction[0];
      var z = own.low().z() - bounds.origin().z() + direction[1];
      if (x >= 0 && x < bounds.sizeX() && z >= 0 && z < bounds.sizeZ())
        overlapping(z * bounds.sizeX() + x, own, result);
    }
    return List.copyOf(result);
  }

  private void overlapping(int column, ColumnInterval own, List<ColumnInterval> result) {
    for (var id = columns[column]; id < columns[column + 1]; id++)
      if (intervals.low[id] <= own.high() && intervals.high[id] >= own.low().y())
        result.add(volume(id));
  }

  public OptionalInt nearest(BlockPos cell) {
    var interval = interval(cell);
    if (interval < 0) return OptionalInt.empty();
    var best = intervals.start[interval];
    for (var portal = best + 1; portal < intervals.start[interval + 1]; portal++)
      if (Math.abs(portals.heights[portal] - cell.y()) < Math.abs(portals.heights[best] - cell.y()))
        best = portal;
    return OptionalInt.of(portals.nodes[best]);
  }

  private int interval(BlockPos cell) {
    if (!bounds.contains(cell)) return -1;
    var column = (cell.z() - bounds.origin().z()) * bounds.sizeX() + cell.x() - bounds.origin().x();
    for (var interval = columns[column]; interval < columns[column + 1]; interval++)
      if (cell.y() >= intervals.low[interval] && cell.y() <= intervals.high[interval])
        return interval;
    return -1;
  }

  @Override
  public boolean equals(Object other) {
    return other instanceof WaterIndex that
        && bounds.equals(that.bounds)
        && Arrays.equals(columns, that.columns)
        && Arrays.equals(intervals.low, that.intervals.low)
        && Arrays.equals(intervals.high, that.intervals.high)
        && Arrays.equals(intervals.start, that.intervals.start)
        && Arrays.equals(portals.nodes, that.portals.nodes)
        && Arrays.equals(portals.heights, that.portals.heights);
  }

  @Override
  public int hashCode() {
    return 31 * bounds.hashCode() + Arrays.hashCode(columns);
  }
}
