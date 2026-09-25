package com.shepherdjerred.thestorm.towns.adapter.paper;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.bukkit.Location;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.type.Chest;
import org.bukkit.inventory.DoubleChestInventory;
import org.bukkit.inventory.Inventory;

/**
 * Double chests: the two halves can sit on either side of a claim border, so every check on one
 * half must also hold for the other, or a chest placed in the wilderness would open a town's chest.
 */
final class Chests {

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
