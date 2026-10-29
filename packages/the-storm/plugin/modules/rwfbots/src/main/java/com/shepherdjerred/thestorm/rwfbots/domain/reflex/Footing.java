package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import java.util.Optional;

/**
 * Whether ground the map's voxels describe will hold a body: a floor block under the feet, room
 * above them, inside the map. Below the map is the void, so nothing outside it ever counts as
 * ground. Kit moves that put the bot somewhere it did not walk (a pearl, a wind charge) check their
 * landing here first.
 */
final class Footing {

  /** How tall a body is, in cells. */
  static final int BODY = 2;

  /** How far apart, blocks, the samples along a stretch of ground are. */
  private static final double SAMPLE = 0.5;

  private Footing() {}

  /** Whether a body standing at {@code feet} has a floor under it, inside the map. */
  static boolean floorAt(VoxelGrid grid, BlockPos feet) {
    var below = feet.down();
    return grid.bounds().contains(below) && grid.blocksMovement(below);
  }

  /** Whether {@code feet} and the {@code height} - 1 cells over it are open, inside the map. */
  static boolean open(VoxelGrid grid, BlockPos feet, int height) {
    for (var dy = 0; dy < height; dy++) {
      var cell = feet.offset(0, dy, 0);
      if (!grid.bounds().contains(cell) || grid.blocksMovement(cell)) {
        return false;
      }
    }
    return true;
  }

  /** Whether a body can stand at {@code feet}. */
  static boolean standable(VoxelGrid grid, BlockPos feet) {
    return floorAt(grid, feet) && open(grid, feet, BODY);
  }

  /** The floor a body falling from {@code column} comes down on within {@code drop}, if any. */
  static Optional<BlockPos> landing(VoxelGrid grid, BlockPos column, int drop) {
    for (var down = 0; down <= drop; down++) {
      var feet = column.offset(0, -down, 0);
      if (!grid.bounds().contains(feet) || grid.blocksMovement(feet)) {
        return Optional.empty();
      }
      if (floorAt(grid, feet)) {
        return Optional.of(feet);
      }
    }
    return Optional.empty();
  }

  /**
   * Whether a body can stand at {@code from} and walk a straight line from there to {@code to}:
   * every column on the way has a floor at most a step above or below the last.
   */
  static boolean wholeGround(VoxelGrid grid, Vec3 from, Vec3 to) {
    var level = BlockPos.of(from);
    if (!standable(grid, level)) {
      return false;
    }
    var flat = to.minus(from).horizontal();
    var steps = (int) Math.ceil(flat.length() / SAMPLE);
    for (var i = 1; i <= steps; i++) {
      var over = BlockPos.of(from.plus(flat.scale((double) i / steps)));
      if (over.x() == level.x() && over.z() == level.z()) {
        continue;
      }
      var next = Optional.<BlockPos>empty();
      for (var dy = -1; dy <= 1 && next.isEmpty(); dy++) {
        var cell = new BlockPos(over.x(), level.y() + dy, over.z());
        if (standable(grid, cell)) {
          next = Optional.of(cell);
        }
      }
      if (next.isEmpty()) {
        return false;
      }
      level = next.orElseThrow();
    }
    return true;
  }
}
