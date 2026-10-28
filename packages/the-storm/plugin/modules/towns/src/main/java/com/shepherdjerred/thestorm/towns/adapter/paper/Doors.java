package com.shepherdjerred.thestorm.towns.adapter.paper;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.Bisected;
import org.bukkit.block.data.type.Door;

/** The other half of a door, and the other door of a pair. */
final class Doors {

  private Doors() {}

  /** The top or bottom of the same door, when that half is the same block type. */
  static Optional<Block> otherHalf(Block block) {
    if (!(block.getBlockData() instanceof Bisected half)) {
      return Optional.empty();
    }
    var other =
        block.getRelative(half.getHalf() == Bisected.Half.TOP ? BlockFace.DOWN : BlockFace.UP);
    return other.getType() == block.getType() ? Optional.of(other) : Optional.empty();
  }

  /**
   * Both halves of the door beside this one, when they face the same way and hinge on the other
   * side. A lone door has none.
   */
  static List<Block> pair(Block block) {
    if (!(block.getBlockData() instanceof Door door)) {
      return List.of();
    }
    var beside =
        block.getRelative(
            door.getHinge() == Door.Hinge.LEFT
                ? clockwise(door.getFacing())
                : counterClockwise(door.getFacing()));
    if (!(beside.getBlockData() instanceof Door other)
        || other.getFacing() != door.getFacing()
        || other.getHinge() == door.getHinge()
        || beside.getType() != block.getType()) {
      return List.of();
    }
    var halves = new ArrayList<Block>(2);
    halves.add(beside);
    otherHalf(beside).ifPresent(halves::add);
    return List.copyOf(halves);
  }

  private static BlockFace clockwise(BlockFace face) {
    return switch (face) {
      case NORTH -> BlockFace.EAST;
      case EAST -> BlockFace.SOUTH;
      case SOUTH -> BlockFace.WEST;
      case WEST -> BlockFace.NORTH;
      default -> face;
    };
  }

  private static BlockFace counterClockwise(BlockFace face) {
    return switch (face) {
      case NORTH -> BlockFace.WEST;
      case WEST -> BlockFace.SOUTH;
      case SOUTH -> BlockFace.EAST;
      case EAST -> BlockFace.NORTH;
      default -> face;
    };
  }
}
