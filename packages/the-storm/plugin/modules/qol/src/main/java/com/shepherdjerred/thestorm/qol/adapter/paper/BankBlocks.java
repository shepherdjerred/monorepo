package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.qol.domain.bank.StoredBank.Spot;
import com.shepherdjerred.thestorm.qol.domain.config.QolConfig;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.Container;
import org.bukkit.block.Sign;
import org.bukkit.block.data.type.WallSign;
import org.bukkit.inventory.Inventory;

/** Which blocks can be a bank, and which container a sign is talking about. */
final class BankBlocks {

  private BankBlocks() {}

  static boolean isContainer(Block block) {
    if (!(block.getState(false) instanceof Container)) {
      return false;
    }
    var key = block.getType().getKey().getKey();
    return block.getType() == Material.CHEST
        || block.getType() == Material.TRAPPED_CHEST
        || block.getType() == Material.BARREL
        || block.getType() == Material.DISPENSER
        || key.endsWith("copper_chest");
  }

  static boolean isSign(Block block) {
    return block.getState(false) instanceof Sign;
  }

  static Spot spot(Block block) {
    return new Spot(block.getWorld().getName(), block.getX(), block.getY(), block.getZ());
  }

  static Optional<Inventory> inventory(Block block) {
    if (block.getState(false) instanceof Container container) {
      return Optional.of(container.getInventory());
    }
    return Optional.empty();
  }

  /**
   * The first container a sign claims. The block in front of the writing is always considered; the
   * rest follow the bank config.
   */
  static Optional<Block> claimed(Block sign, QolConfig.Bank bank) {
    var facing = facing(sign);
    if (facing.isEmpty()) {
      return Optional.empty();
    }
    var face = facing.orElseThrow();
    var candidates = new ArrayList<Block>();
    candidates.add(sign.getRelative(face));
    if (bank.signInFront()) {
      attached(sign, face).ifPresent(candidates::add);
    }
    if (bank.verticalTwo()) {
      candidates.add(sign.getRelative(BlockFace.UP, 2));
      candidates.add(sign.getRelative(BlockFace.DOWN, 2));
    }
    if (bank.horizontalTwo()) {
      var left = rotate(face);
      candidates.add(sign.getRelative(left, 2));
      candidates.add(sign.getRelative(left.getOppositeFace(), 2));
    }
    for (var candidate : candidates) {
      if (isContainer(candidate)) {
        return Optional.of(candidate);
      }
    }
    return Optional.empty();
  }

  /** The other half of a double chest, when {@code block} is one. */
  static Optional<Block> otherHalf(Block block) {
    if (!(block.getBlockData() instanceof org.bukkit.block.data.type.Chest chest)
        || chest.getType() == org.bukkit.block.data.type.Chest.Type.SINGLE) {
      return Optional.empty();
    }
    var facing = chest.getFacing();
    var side =
        switch (chest.getType()) {
          case LEFT -> clockwise(facing);
          case RIGHT -> rotate(facing);
          case SINGLE -> facing;
        };
    return Optional.of(block.getRelative(side));
  }

  static List<Block> halves(Block block) {
    var blocks = new ArrayList<Block>();
    blocks.add(block);
    otherHalf(block).ifPresent(blocks::add);
    return blocks;
  }

  private static Optional<BlockFace> facing(Block sign) {
    var data = sign.getBlockData();
    if (data instanceof WallSign wall) {
      return Optional.of(wall.getFacing());
    }
    if (data instanceof org.bukkit.block.data.type.Sign standing) {
      return Optional.of(cardinal(standing.getRotation()));
    }
    return Optional.empty();
  }

  private static Optional<Block> attached(Block sign, BlockFace facing) {
    var data = sign.getBlockData();
    if (data instanceof WallSign) {
      return Optional.of(sign.getRelative(facing.getOppositeFace()));
    }
    if (data instanceof org.bukkit.block.data.type.Sign) {
      return Optional.of(sign.getRelative(BlockFace.DOWN));
    }
    return Optional.empty();
  }

  /** The nearest cardinal of a standing sign's 16-way rotation. */
  private static BlockFace cardinal(BlockFace rotation) {
    return switch (rotation) {
      case NORTH, NORTH_NORTH_EAST, NORTH_NORTH_WEST -> BlockFace.NORTH;
      case EAST, EAST_NORTH_EAST, EAST_SOUTH_EAST -> BlockFace.EAST;
      case SOUTH, SOUTH_SOUTH_EAST, SOUTH_SOUTH_WEST -> BlockFace.SOUTH;
      case WEST, WEST_NORTH_WEST, WEST_SOUTH_WEST -> BlockFace.WEST;
      default -> rotation;
    };
  }

  /** The face to the left of {@code face}, looking along it. Counter-clockwise. */
  private static BlockFace rotate(BlockFace face) {
    return switch (face) {
      case NORTH -> BlockFace.WEST;
      case EAST -> BlockFace.NORTH;
      case SOUTH -> BlockFace.EAST;
      case WEST -> BlockFace.SOUTH;
      default -> BlockFace.NORTH;
    };
  }

  private static BlockFace clockwise(BlockFace face) {
    return rotate(face).getOppositeFace();
  }
}
