package com.shepherdjerred.thestorm.mechanics.domain.piston;

import com.shepherdjerred.thestorm.mechanics.domain.grid.BlockGrid;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Cell;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Mobility;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * What special pistons may do. A blacklisted block, a block entity (container, spawner, vault) and
 * an unbreakable block are never crushed or moved; super pistons also leave alone anything vanilla
 * pistons would not move the same way.
 *
 * @param blacklist materials never crushed or moved
 */
public record PistonRules(Set<String> blacklist) {

  public PistonRules {
    blacklist = Set.copyOf(blacklist);
  }

  /** A crushing piston may break this block. */
  public boolean crushable(Cell cell) {
    return !cell.shape().isPlaceable() && !cell.fixed() && !blacklist.contains(cell.material());
  }

  private boolean pushable(Cell cell) {
    return (cell.mobility() == Mobility.NORMAL || cell.mobility() == Mobility.PUSH_ONLY)
        && crushable(cell);
  }

  private boolean pullable(Cell cell) {
    return cell.mobility() == Mobility.NORMAL && crushable(cell);
  }

  /**
   * A super-sticky piston at {@code piston} facing {@code facing} has just retracted: pull the
   * blocks in front of it toward it, closing every gap, until a block that cannot be pulled, the
   * end of its reach, or {@code maxBlocks} moved blocks. Moves are ordered nearest first.
   */
  public List<BlockMove> pull(BlockGrid grid, Pos piston, Direction facing, Reach reach) {
    var moves = new ArrayList<BlockMove>();
    var next = 1;
    for (var distance = 1;
        distance <= reach.distance() && moves.size() < reach.maxBlocks();
        distance++) {
      var from = piston.offset(facing, distance);
      if (!grid.contains(from)) {
        break;
      }
      var cell = grid.cellAt(from);
      if (cell.shape().isPlaceable()) {
        continue;
      }
      if (!pullable(cell)) {
        break;
      }
      if (distance != next) {
        moves.add(new BlockMove(from, piston.offset(facing, next)));
      }
      next++;
    }
    return moves;
  }

  /**
   * A super-push piston at {@code piston} facing {@code facing} has just extended: push the line of
   * blocks in front of its head up to {@code reach.distance()} blocks further, as far as free space
   * allows. A line longer than {@code reach.maxBlocks()} is too heavy and stays. Moves are ordered
   * farthest first.
   */
  public List<BlockMove> push(BlockGrid grid, Pos piston, Direction facing, Reach reach) {
    var start = piston.offset(facing, 2);
    var line = new ArrayList<Pos>();
    var pos = start;
    while (grid.contains(pos) && pushable(grid.cellAt(pos))) {
      if (line.size() == reach.maxBlocks()) {
        return List.of();
      }
      line.add(pos);
      pos = pos.offset(facing);
    }
    var free = 0;
    while (free < reach.distance()
        && grid.contains(pos.offset(facing, free))
        && grid.cellAt(pos.offset(facing, free)).shape().isPlaceable()) {
      free++;
    }
    if (line.isEmpty() || free == 0) {
      return List.of();
    }
    var moves = new ArrayList<BlockMove>();
    for (var index = line.size() - 1; index >= 0; index--) {
      var from = line.get(index);
      moves.add(new BlockMove(from, from.offset(facing, free)));
    }
    return moves;
  }

  /**
   * How far a super piston reaches.
   *
   * @param distance for super-sticky, how far in front blocks are pulled from; for super-push, how
   *     many extra blocks the load travels
   * @param maxBlocks the most blocks moved at once
   */
  public record Reach(int distance, int maxBlocks) {

    public Reach {
      if (distance < 1 || maxBlocks < 1) {
        throw new IllegalArgumentException(
            "reach must be positive: " + distance + ", " + maxBlocks);
      }
    }
  }

  /** Whether {@code material} is a piston that pulls. */
  public static boolean isSticky(String material) {
    return material.equals("minecraft:sticky_piston");
  }

  /** Whether {@code material} is a piston. */
  public static boolean isPiston(String material) {
    return material.equals("minecraft:piston") || isSticky(material);
  }
}
