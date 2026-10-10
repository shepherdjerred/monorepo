package com.shepherdjerred.thestorm.tools.rwfmap;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import java.util.List;
import java.util.Set;

/** Exact schematic checks for grounded starts; coarse navigation shapes are insufficient. */
final class StartTerrain {
  private static final Set<String> AIR =
      Set.of("minecraft:air", "minecraft:cave_air", "minecraft:void_air");
  private static final Set<String> CUBES =
      Set.of(
          "stone",
          "cobblestone",
          "mossy_cobblestone",
          "stone_bricks",
          "bricks",
          "dirt",
          "coarse_dirt",
          "grass_block",
          "podzol",
          "mycelium",
          "rooted_dirt",
          "sand",
          "red_sand",
          "gravel",
          "clay",
          "sandstone",
          "red_sandstone",
          "smooth_sandstone",
          "smooth_red_sandstone",
          "terracotta",
          "granite",
          "andesite",
          "diorite",
          "obsidian",
          "crying_obsidian",
          "bedrock",
          "netherrack",
          "end_stone",
          "prismarine",
          "dark_prismarine",
          "quartz_block",
          "smooth_quartz",
          "purpur_block",
          "iron_block",
          "gold_block",
          "diamond_block",
          "emerald_block",
          "lapis_block",
          "coal_block");
  private static final List<String> CUBE_SUFFIXES =
      List.of(
          "_planks",
          "_wool",
          "_concrete",
          "_terracotta",
          "_bricks",
          "_tiles",
          "_log",
          "_wood",
          "_ore");
  private final SchematicClassification blocks;

  StartTerrain(SchematicClassification blocks) {
    this.blocks = blocks;
  }

  boolean patch(BlockPos feet, int radius) {
    for (var dx = -radius; dx <= radius; dx++) {
      for (var dz = -radius; dz <= radius; dz++) {
        if (!standing(feet.offset(dx, 0, dz))) return false;
      }
    }
    return true;
  }

  boolean standing(BlockPos feet) {
    return blocks.bounds().contains(feet.down())
        && blocks.bounds().contains(feet.up())
        && AIR.contains(state(feet))
        && AIR.contains(state(feet.up()))
        && support(state(feet.down()));
  }

  private String state(BlockPos cell) {
    var origin = blocks.bounds().origin();
    var schematic = blocks.schematic();
    return schematic
        .palette()
        .get(
            schematic.paletteIndex(
                cell.x() - origin.x(), cell.y() - origin.y(), cell.z() - origin.z()));
  }

  static boolean support(String raw) {
    var block = BlockState.parse(raw);
    if (block.idEndsWith("_slab")) return Set.of("top", "double").contains(block.property("type"));
    return CUBES.contains(block.id()) || CUBE_SUFFIXES.stream().anyMatch(block::idEndsWith);
  }

  /** Ground and two blocks of real air under the full 0.6-block-wide walking corridor. */
  boolean corridor(Vec3 from, Vec3 to) {
    var delta = to.minus(from);
    var length = from.horizontalDistance(to);
    var steps = (int) Math.ceil(length * 4);
    var sideways = new Vec3(-delta.z() / length * 0.3, 0, delta.x() / length * 0.3);
    for (var step = 0; step <= steps; step++) {
      var middle = from.plus(delta.scale((double) step / steps));
      if (!standing(BlockPos.of(middle.plus(sideways)))
          || !standing(BlockPos.of(middle.minus(sideways)))) return false;
    }
    return true;
  }
}
