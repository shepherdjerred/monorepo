package com.shepherdjerred.thestorm.towns.adapter.paper;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.bukkit.Location;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.type.Chest;
import org.bukkit.block.data.type.Shelf;
import org.bukkit.inventory.DoubleChestInventory;
import org.bukkit.inventory.Inventory;

/**
 * Double chests and shelf rows: their parts can sit on either side of a claim border, so every
 * check on one part must also hold for the others, or a chest or shelf placed in the wilderness
 * would open a town's.
 */
final class Chests {

  /** How far along a row of shelves a use or placement is checked. */
  static final int SHELF_REACH = 3;

  private Chests() {}

  /** The other half of the double chest {@code block} belongs to, if it is one. */
  static Optional<Block> partner(Block block) {
    if (!(block.getBlockData() instanceof Chest chest) || chest.getType() == Chest.Type.SINGLE) {
      return Optional.empty();
    }
    var facing = chest.getFacing();
    // Vanilla's ChestBlock#getConnectedDirection: the left half connects clockwise of its facing.
    var toward =
        chest.getType() == Chest.Type.LEFT
            ? clockwise(facing)
            : clockwise(facing).getOppositeFace();
    return Optional.of(block.getRelative(toward));
  }

  /**
   * Where {@code inventory}'s items are: both halves of a double chest, else its one location, else
   * nowhere for an inventory with no place in the world.
   */
  static List<Location> locations(Inventory inventory) {
    if (inventory instanceof DoubleChestInventory chest) {
      var halves = new ArrayList<Location>(2);
      for (var half : List.of(chest.getLeftSide(), chest.getRightSide())) {
        var location = half.getLocation();
        if (location != null) {
          halves.add(location);
        }
      }
      return List.copyOf(halves);
    }
    var location = inventory.getLocation();
    return location == null ? List.of() : List.of(location);
  }

  /**
   * The shelves {@code block} may swap items with: itself and up to {@link #SHELF_REACH} shelves
   * facing the same way on each side (vanilla chains at most three, so this over-covers). Empty
   * when {@code block} is not a shelf.
   */
  static List<Block> shelfChain(Block block) {
    if (!(block.getBlockData() instanceof Shelf shelf)) {
      return List.of();
    }
    var facing = shelf.getFacing();
    var chain = new ArrayList<Block>();
    chain.add(block);
    for (var side : List.of(clockwise(facing), clockwise(facing).getOppositeFace())) {
      var next = block;
      for (var step = 0; step < SHELF_REACH; step++) {
        next = next.getRelative(side);
        if (!(next.getBlockData() instanceof Shelf neighbour) || neighbour.getFacing() != facing) {
          break;
        }
        chain.add(next);
      }
    }
    return List.copyOf(chain);
  }

  /**
   * The shelves beside a shelf about to be placed facing {@code facing} at {@code block}, which it
   * would chain with.
   */
  static List<Block> shelvesBeside(Block block, BlockFace facing) {
    var beside = new ArrayList<Block>(2);
    for (var side : List.of(clockwise(facing), clockwise(facing).getOppositeFace())) {
      var neighbour = block.getRelative(side);
      if (neighbour.getBlockData() instanceof Shelf shelf && shelf.getFacing() == facing) {
        beside.add(neighbour);
      }
    }
    return List.copyOf(beside);
  }

  private static BlockFace clockwise(BlockFace face) {
    return switch (face) {
      case NORTH -> BlockFace.EAST;
      case EAST -> BlockFace.SOUTH;
      case SOUTH -> BlockFace.WEST;
      case WEST -> BlockFace.NORTH;
      default -> throw new IllegalArgumentException("a chest cannot face " + face);
    };
  }
}
