package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Random;
import java.util.function.Predicate;
import org.bukkit.Material;
import org.bukkit.TreeType;
import org.bukkit.block.Block;
import org.bukkit.block.BlockState;

/** Generates into Paper's staging predicate, checks the entire tree, then applies the plan. */
final class CircuitGrowth {
  private final CircuitAccess access;

  CircuitGrowth(CircuitAccess access) {
    this.access = access;
  }

  boolean grow(CircuitAccess.Visit visit, Block plant, Runnable consume) {
    var type = type(plant.getType());
    if (type.isEmpty()) return false;
    var world = plant.getWorld();
    for (var dx = -1; dx <= 1; dx++)
      for (var dz = -1; dz <= 1; dz++) {
        if (!world.isChunkLoaded((plant.getX() >> 4) + dx, (plant.getZ() >> 4) + dz)) return false;
      }
    if (!access.may(visit, plant, ProtectedAction.AUTOMATIC_BUILD, ProtectedAction.AUTOMATIC_BREAK))
      return false;
    var planned = stage(visit, plant, type.orElseThrow());
    if (planned.isEmpty()
        || planned.stream()
            .anyMatch(state ->
                !access.may(
                    visit,
                    state.getBlock(),
                    ProtectedAction.AUTOMATIC_BUILD,
                    ProtectedAction.AUTOMATIC_BREAK))) return false;
    consume.run();
    for (var state : planned) access.set(visit, state.getBlock(), state.getBlockData());
    return true;
  }

  private List<BlockState> stage(CircuitAccess.Visit visit, Block plant, TreeType type) {
    var original = plant.getBlockData();
    var planned = new ArrayList<BlockState>();
    // Bukkit's generator requires air at the origin. Clear only this authorized plant,
    // without physics, and restore it before checking or committing the complete plan.
    access
        .kit()
        .changes()
        .set(visit.actor().toString(), plant, Material.AIR.createBlockData(), false);
    try {
      var made =
          plant
              .getWorld()
              .generateTree(
                  plant.getLocation(),
                  Random.from(access.context().random()),
                  type,
                  (Predicate<BlockState>)
                      state -> {
                        planned.add(state);
                        return false;
                      });
      return made ? List.copyOf(planned) : List.of();
    } finally {
      access.kit().changes().set(visit.actor().toString(), plant, original, false);
    }
  }

  private static Optional<TreeType> type(Material material) {
    return switch (material) {
      case OAK_SAPLING -> Optional.of(TreeType.TREE);
      case SPRUCE_SAPLING -> Optional.of(TreeType.REDWOOD);
      case BIRCH_SAPLING -> Optional.of(TreeType.BIRCH);
      case JUNGLE_SAPLING -> Optional.of(TreeType.SMALL_JUNGLE);
      case ACACIA_SAPLING -> Optional.of(TreeType.ACACIA);
      case DARK_OAK_SAPLING -> Optional.of(TreeType.DARK_OAK);
      case RED_MUSHROOM -> Optional.of(TreeType.RED_MUSHROOM);
      case BROWN_MUSHROOM -> Optional.of(TreeType.BROWN_MUSHROOM);
      default -> Optional.empty();
    };
  }
}
