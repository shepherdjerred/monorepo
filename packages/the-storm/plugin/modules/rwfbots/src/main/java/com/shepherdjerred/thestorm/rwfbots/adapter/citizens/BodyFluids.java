package com.shepherdjerred.thestorm.rwfbots.adapter.citizens;

import static java.util.Objects.requireNonNull;

import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.data.Waterlogged;
import org.bukkit.entity.Player;

/** Actual occupied fluid blocks, including waterlogged data when the NPC water flag is absent. */
final class BodyFluids {
  private BodyFluids() {}

  static boolean inWater(Player player) {
    var feet = requireNonNull(player.getLocation());
    return occupiedWater(player)
        || feet.clone().subtract(0, 0.1, 0).getBlock().getType() == Material.WATER;
  }

  /** Occupied native fluid/climb contact; water merely below dry feet cannot cancel a fall. */
  static boolean cancelsFall(Player player) {
    return player.isClimbing() || player.isInWater() || occupiedWater(player);
  }

  private static boolean occupiedWater(Player player) {
    var feet = requireNonNull(player.getLocation());
    var eyes = requireNonNull(player.getEyeLocation());
    return containsWater(feet.getBlock())
        || containsWater(feet.clone().add(0, 0.9, 0).getBlock())
        || containsWater(eyes.getBlock());
  }

  static boolean containsWater(Block block) {
    if (block.getType() == Material.WATER) return true;
    if (block.getBlockData() instanceof Waterlogged data && data.isWaterlogged()) return true;
    return switch (block.getType()) {
      case SEAGRASS, TALL_SEAGRASS, KELP, KELP_PLANT, BUBBLE_COLUMN -> true;
      default -> false;
    };
  }
}
