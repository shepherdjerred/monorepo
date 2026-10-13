package com.shepherdjerred.thestorm.rwfbots.domain.map;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import java.util.ArrayList;
import java.util.BitSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.NavigableSet;
import java.util.OptionalInt;
import java.util.TreeSet;
import java.util.function.IntUnaryOperator;

/** Offline contraction of fluid columns; overlap portals preserve full underwater connectivity. */
final class WaterTopology {
  private static final int[][] CARDINAL = {{1, 0}, {-1, 0}, {0, 1}, {0, -1}};
  private final BlockClassification blocks;
  private final GridBounds bounds;
  private final Map<Integer, List<Span>> columns = new HashMap<>();
  private final BitSet nodes = new BitSet();

  private record Span(int low, int high, NavigableSet<Integer> portals) {
    boolean contains(int y) {
      return y >= low && y <= high;
    }
  }

  private WaterTopology(BlockClassification blocks) {
    this.blocks = blocks;
    bounds = blocks.bounds();
  }

  static WaterTopology build(BlockClassification blocks, NavSites sites) {
    var water = new WaterTopology(blocks);
    water.scan();
    water.connectColumns();
    water.landInterfaces();
    sites.spawns().forEach(site -> water.include(site.cell()));
    sites.bombs().forEach(site -> water.include(site.cell()));
    water.retainNodes();
    return water;
  }

  private void scan() {
    for (var z = 0; z < bounds.sizeZ(); z++)
      for (var x = 0; x < bounds.sizeX(); x++) scanColumn(x, z);
  }

  private void scanColumn(int x, int z) {
    var spans = new ArrayList<Span>();
    var low = -1;
    for (var y = 0; y <= bounds.sizeY(); y++) {
      var cell = bounds.origin().offset(x, y, z);
      if (fitsWater(cell)) {
        if (low < 0) low = y;
      } else if (low >= 0) {
        var floor = bounds.origin().y() + low;
        var ceiling = cell.y() - 1;
        var portals = new TreeSet<Integer>();
        portals.add(floor);
        portals.add(ceiling);
        spans.add(new Span(floor, ceiling, portals));
        low = -1;
      }
    }
    if (!spans.isEmpty()) columns.put(z * bounds.sizeX() + x, spans);
  }

  private boolean fitsWater(BlockPos cell) {
    return bounds.contains(cell)
        && bounds.contains(cell.up())
        && shape(cell).swim()
        && !shape(cell.up()).blocksMovement();
  }

  private BlockShape shape(BlockPos cell) {
    return bounds.contains(cell) ? blocks.shape(cell.x(), cell.y(), cell.z()) : BlockShape.FULL;
  }

  private void connectColumns() {
    for (var entry : columns.entrySet()) {
      var x = entry.getKey() % bounds.sizeX();
      var z = entry.getKey() / bounds.sizeX();
      if (x + 1 < bounds.sizeX()) overlap(entry.getValue(), column(x + 1, z));
      if (z + 1 < bounds.sizeZ()) overlap(entry.getValue(), column(x, z + 1));
    }
  }

  private static void overlap(List<Span> one, List<Span> two) {
    for (var a : one) {
      for (var b : two) {
        var low = Math.max(a.low(), b.low());
        var high = Math.min(a.high(), b.high());
        if (low <= high) {
          a.portals().add(low);
          a.portals().add(high);
          b.portals().add(low);
          b.portals().add(high);
        }
      }
    }
  }

  private List<Span> column(int x, int z) {
    return columns.getOrDefault(z * bounds.sizeX() + x, List.of());
  }

  private void landInterfaces() {
    var origin = bounds.origin();
    for (var y = 0; y < bounds.sizeY(); y++)
      for (var z = 0; z < bounds.sizeZ(); z++)
        for (var x = 0; x < bounds.sizeX(); x++) includeLand(origin.offset(x, y, z));
  }

  private void includeLand(BlockPos cell) {
    var shape = shape(cell);
    if (shape.swim()
        || shape.blocksMovement()
        || shape(cell.up()).blocksMovement()
        || !(shape.climbable() || shape(cell.down()).standable())) return;
    for (var direction : CARDINAL) {
      var adjacent = cell.offset(direction[0], 0, direction[1]);
      include(adjacent);
      include(adjacent.down());
      include(adjacent.up());
    }
  }

  private void include(BlockPos cell) {
    if (!bounds.contains(cell)) return;
    for (var span : column(cell.x() - bounds.origin().x(), cell.z() - bounds.origin().z()))
      if (span.contains(cell.y())) span.portals().add(cell.y());
  }

  private void retainNodes() {
    for (var entry : columns.entrySet()) {
      var x = bounds.origin().x() + entry.getKey() % bounds.sizeX();
      var z = bounds.origin().z() + entry.getKey() / bounds.sizeX();
      for (var span : entry.getValue())
        for (var y : span.portals()) nodes.set(bounds.index(x, y, z));
    }
  }

  boolean node(BlockPos cell) {
    return nodes.get(bounds.index(cell));
  }

  OptionalInt next(BlockPos cell, boolean above) {
    if (!bounds.contains(cell)) return OptionalInt.empty();
    for (var span : column(cell.x() - bounds.origin().x(), cell.z() - bounds.origin().z())) {
      if (!span.contains(cell.y())) continue;
      var next = above ? span.portals().higher(cell.y()) : span.portals().lower(cell.y());
      return next == null ? OptionalInt.empty() : OptionalInt.of(next);
    }
    return OptionalInt.empty();
  }

  WaterIndex index(IntUnaryOperator nodeAtCell) {
    var starts = new int[bounds.sizeX() * bounds.sizeZ() + 1];
    var low = new ArrayList<Integer>();
    var high = new ArrayList<Integer>();
    var portalStart = new ArrayList<Integer>();
    var portalNodes = new ArrayList<Integer>();
    var heights = new ArrayList<Integer>();
    portalStart.add(0);
    for (var column = 0; column < starts.length - 1; column++) {
      for (var span : columns.getOrDefault(column, List.of())) {
        low.add(span.low());
        high.add(span.high());
        for (var y : span.portals()) {
          var cell =
              bounds.index(
                  bounds.origin().x() + column % bounds.sizeX(),
                  y,
                  bounds.origin().z() + column / bounds.sizeX());
          portalNodes.add(nodeAtCell.applyAsInt(cell));
          heights.add(y);
        }
        portalStart.add(portalNodes.size());
      }
      starts[column + 1] = low.size();
    }
    return new WaterIndex(
        bounds,
        starts,
        new WaterIndex.Intervals(ints(low), ints(high), ints(portalStart)),
        new WaterIndex.Portals(ints(portalNodes), ints(heights)));
  }

  private static int[] ints(List<Integer> values) {
    return values.stream().mapToInt(Integer::intValue).toArray();
  }
}
