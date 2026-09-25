package com.shepherdjerred.thestorm.mechanics.domain.structure;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.mechanics.domain.config.GateConfig;
import com.shepherdjerred.thestorm.mechanics.domain.grid.BlockGrid;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Box;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Finds the gate a {@code [Gate]} sign controls, once, when the sign is written.
 *
 * <p>Every block of an allowed material within the search radius belongs to a column, whose top is
 * the highest block of that material directly above it. The gate's material is the nearest
 * column's; columns of other materials are left alone, and only the nearest {@code maxColumns}
 * belong to the gate. The sign remembers those tops; on use the gate is rebuilt from them, never
 * searched for again. The top of each column always stays; below it the column fills down through
 * air and water until it meets anything else, at most {@code maxHeight} blocks.
 */
public final class GateFinder {

  private GateFinder() {}

  /** The gate near {@code sign}. */
  public static Result<Gate, StructureProblem> find(BlockGrid grid, Pos sign, GateConfig config) {
    var tops = columnTops(grid, sign, config);
    if (tops.isEmpty()) {
      return Result.err(new StructureProblem.NoGate(config.searchRadius()));
    }
    Comparator<Pos> nearestFirst =
        Comparator.<Pos>comparingLong(top -> top.distanceSquared(sign)).thenComparing(Pos.ORDER);
    var nearest =
        tops.entrySet().stream().min(Map.Entry.comparingByKey(nearestFirst)).orElseThrow();
    var material = nearest.getValue();
    var chosen =
        tops.entrySet().stream()
            .filter(entry -> entry.getValue().equals(material))
            .map(Map.Entry::getKey)
            .sorted(nearestFirst)
            .limit(config.maxColumns())
            .toList();
    return Result.ok(new Gate(material, nearest.getKey(), chosen));
  }

  /** The spaces {@code gate}'s columns fill when closed. */
  public static Structure columns(BlockGrid grid, Gate gate, int maxHeight) {
    var tops = Set.copyOf(gate.tops());
    var cells = new ArrayList<Pos>();
    for (var top : gate.tops()) {
      cells.addAll(column(grid, top, gate.material(), new ColumnLimits(maxHeight, tops)));
    }
    return new Structure(gate.material(), gate.anchor(), cells);
  }

  /** Whether {@code top} is still the top of a column of {@code material}. */
  public static boolean isTop(BlockGrid grid, Pos top, String material) {
    var above = top.offset(Direction.UP);
    return grid.cellAt(top).is(material)
        && !(grid.contains(above) && grid.cellAt(above).is(material));
  }

  /** Every column top in the search box, with its material. */
  private static Map<Pos, String> columnTops(BlockGrid grid, Pos sign, GateConfig config) {
    var allowed = config.allowed();
    var tops = new HashMap<Pos, String>();
    var seen = new HashSet<Pos>();
    for (var pos : Box.around(sign, config.searchRadius())) {
      if (!grid.contains(pos) || seen.contains(pos)) {
        continue;
      }
      var material = grid.cellAt(pos).material();
      if (allowed.contains(material)) {
        tops.put(climb(grid, pos, material, seen), material);
      }
    }
    return tops;
  }

  /** The top of the column through {@code pos}, marking every block passed as seen. */
  private static Pos climb(BlockGrid grid, Pos pos, String material, Set<Pos> seen) {
    var top = pos;
    seen.add(top);
    while (grid.contains(top.offset(Direction.UP))
        && grid.cellAt(top.offset(Direction.UP)).is(material)) {
      top = top.offset(Direction.UP);
      seen.add(top);
    }
    return top;
  }

  private record ColumnLimits(int maxHeight, Set<Pos> tops) {}

  /** The spaces below {@code top} that the column fills when closed. */
  private static List<Pos> column(BlockGrid grid, Pos top, String material, ColumnLimits limits) {
    var cells = new ArrayList<Pos>();
    for (var depth = 1; depth <= limits.maxHeight(); depth++) {
      var pos = top.offset(Direction.DOWN, depth);
      if (!grid.contains(pos) || limits.tops().contains(pos)) {
        break;
      }
      var cell = grid.cellAt(pos);
      if (!cell.is(material) && !cell.shape().isPlaceable()) {
        break;
      }
      cells.add(pos);
    }
    return cells;
  }
}
