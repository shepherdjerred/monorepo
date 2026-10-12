package com.shepherdjerred.thestorm.arena.domain.survival;

import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.arena.domain.geometry.Cuboid;
import java.util.Comparator;
import java.util.Map;

/** Human-scale workshops contrast with tanks, gantries, halls and planted courtyards. */
final class RustworksLandmarks {
  private record Style(String wall, String beam, String roof, String furnishing) {}

  private record Hall(int x1, int z1, int x2, int z2, int top, Style style) {}

  private final SurvivalContent content;
  private final Map<BlockPos, String> blocks;

  RustworksLandmarks(SurvivalContent content, Map<BlockPos, String> blocks) {
    this.content = content;
    this.blocks = blocks;
  }

  void apply() {
    for (var zone : content.zones()) {
      var area =
          zone.areas().stream()
              .max(Comparator.comparingInt(RustworksLandmarks::size))
              .orElseThrow();
      switch (zone.id()) {
        case "railhead", "freight", "coalyard" -> railYard(area);
        case "boilers", "pumpstation", "canal" -> tanks(area);
        case "crane", "blastpit" -> gantry(area);
        case "roofgarden", "washhouse" -> gardens(area);
        default -> hall(area, style(zone.id()));
      }
      lights(area);
    }
  }

  private static int size(Cuboid area) {
    return (area.max().x() - area.min().x() + 1) * (area.max().z() - area.min().z() + 1);
  }

  private static Style style(String id) {
    return switch (id) {
      case "canteen", "clinic" ->
          new Style("WHITE_TERRACOTTA", "STRIPPED_DARK_OAK_LOG", "DARK_OAK_PLANKS", "BARREL");
      case "warehouse", "signal", "barracks" ->
          new Style("BRICKS", "POLISHED_DEEPSLATE", "WAXED_CUT_COPPER", "BOOKSHELF");
      case "foundry", "generator", "presshall" ->
          new Style("BRICKS", "POLISHED_BASALT", "OXIDIZED_CUT_COPPER", "BLAST_FURNACE");
      case "glassworks", "loom" ->
          new Style("LIGHT_GRAY_TERRACOTTA", "POLISHED_ANDESITE", "OXIDIZED_CUT_COPPER", "LOOM");
      case "crypt", "control", "ramparts" ->
          new Style("DEEPSLATE_BRICKS", "POLISHED_BASALT", "DEEPSLATE_TILES", "CHISELED_BOOKSHELF");
      case "hangar" -> new Style("MUD_BRICKS", "STRIPPED_SPRUCE_LOG", "DARK_OAK_PLANKS", "BARREL");
      default -> throw new IllegalArgumentException("No Rustworks landmark for " + id);
    };
  }

  private void hall(Cuboid area, Style style) {
    var x1 = area.min().x() + 10;
    var z1 = area.min().z() + 5;
    var x2 = area.max().x() - 8;
    var z2 = area.max().z() - 8;
    var height =
        switch (style.furnishing()) {
          case "BLAST_FURNACE" -> 9;
          case "BARREL" -> 5;
          default -> 7;
        };
    var top = RustworksBlueprint.elevation(x2, z2) + height;
    var hall = new Hall(x1, z1, x2, z2, top, style);
    for (var x = x1; x <= x2; x++) {
      for (var z = z1; z <= z2; z++) {
        hallCell(hall, x, z);
      }
    }
    doors(x1, z1, x2, z2);
    for (var x = x1 + 3; x <= x2 - 3; x += 4) {
      var z = z1 + 2;
      put(x, RustworksBlueprint.elevation(x, z) + 1, z, style.furnishing());
      put(x, top - 1, z + 2, "LANTERN");
    }
    if (style.furnishing().equals("BLAST_FURNACE")) chimney(x2 - 2, z2 - 2);
    if (style.furnishing().equals("CHISELED_BOOKSHELF")) clock(x1 + 1, z1 + 1);
  }

  private void hallCell(Hall hall, int x, int z) {
    var floor = RustworksBlueprint.elevation(x, z);
    put(x, floor, z, "DARK_OAK_PLANKS");
    var edge = x == hall.x1() || x == hall.x2() || z == hall.z1() || z == hall.z2();
    var corner = (x == hall.x1() || x == hall.x2()) && (z == hall.z1() || z == hall.z2());
    for (var y = floor + 1; y <= hall.top(); y++)
      put(
          x,
          y,
          z,
          !edge ? "AIR" : corner || y == hall.top() ? hall.style().beam() : hall.style().wall());
    var inset =
        Math.min(Math.min(x - hall.x1(), hall.x2() - x), Math.min(z - hall.z1(), hall.z2() - z));
    put(x, hall.top() + 1 + Math.min(3, inset), z, hall.style().roof());
    if (edge && !corner) put(x, floor + 3, z, "LIGHT_GRAY_STAINED_GLASS");
  }

  private void doors(int x1, int z1, int x2, int z2) {
    for (var x = (x1 + x2) / 2 - 1; x <= (x1 + x2) / 2 + 1; x++) {
      clearDoor(x, z1);
      clearDoor(x, z2);
    }
    for (var z = (z1 + z2) / 2 - 1; z <= (z1 + z2) / 2 + 1; z++) {
      clearDoor(x1, z);
      clearDoor(x2, z);
    }
  }

  private void clearDoor(int x, int z) {
    var floor = RustworksBlueprint.elevation(x, z);
    for (var y = floor + 1; y <= floor + 3; y++) put(x, y, z, "AIR");
  }

  private void chimney(int x, int z) {
    var floor = RustworksBlueprint.elevation(x, z);
    for (var dx = 0; dx < 3; dx++)
      for (var dz = 0; dz < 3; dz++)
        for (var y = floor + 1; y <= floor + 18; y++)
          put(x + dx, y, z + dz, dx == 1 && dz == 1 ? "AIR" : "BRICKS");
    put(x + 1, floor + 19, z + 1, "IRON_BARS");
  }

  private void clock(int x, int z) {
    var floor = RustworksBlueprint.elevation(x, z);
    for (var y = floor + 1; y <= floor + 12; y++) {
      put(x, y, z, "POLISHED_DEEPSLATE");
      put(x + 1, y, z, "POLISHED_DEEPSLATE");
    }
    put(x, floor + 10, z - 1, "GOLD_BLOCK");
    put(x + 1, floor + 10, z - 1, "LIGHT_GRAY_CONCRETE");
    put(x, floor + 13, z, "OXIDIZED_CUT_COPPER");
  }

  private void railYard(Cuboid area) {
    var z1 = area.min().z() + 6;
    var z2 = area.max().z() - 7;
    for (var x : new int[] {area.min().x() + 13, area.min().x() + 20}) {
      for (var z = z1; z <= z2; z++) {
        var y = RustworksBlueprint.elevation(x, z);
        put(x, y, z, "DARK_OAK_PLANKS");
        put(x, y + 1, z, "RAIL");
      }
      for (var z = z1 + 4; z < z2 - 2; z++)
        put(x + 2, RustworksBlueprint.elevation(x + 2, z) + 1, z, "BARREL");
    }
    gantry(area);
  }

  private void tanks(Cuboid area) {
    for (var x : new int[] {area.min().x() + 14, area.max().x() - 11}) {
      var z = area.min().z() + 11;
      tank(x, z);
    }
  }

  private void tank(int x, int z) {
    var base = RustworksBlueprint.elevation(x, z);
    for (var dx = -3; dx <= 3; dx++) {
      for (var dz = -3; dz <= 3; dz++) {
        if (dx * dx + dz * dz > 10) continue;
        for (var y = base; y <= base + 7; y++)
          put(x + dx, y, z + dz, y == base + 7 ? "OXIDIZED_CUT_COPPER" : "WAXED_CUT_COPPER");
      }
    }
    for (var pipe = 0; pipe <= 7; pipe++) put(x, base + 3, z + 4 + pipe, "WAXED_COPPER_GRATE");
  }

  private void gantry(Cuboid area) {
    var x = area.min().x() + 12;
    var z = area.min().z() + 7;
    var base = RustworksBlueprint.elevation(x, z);
    for (var dx : new int[] {0, 12})
      for (var y = base + 1; y <= base + 11; y++) put(x + dx, y, z, "POLISHED_DEEPSLATE");
    for (var dx = 0; dx <= 12; dx++) put(x + dx, base + 12, z, "OXIDIZED_CUT_COPPER");
    for (var y = base + 7; y <= base + 11; y++) put(x + 6, y, z, "IRON_CHAIN");
    put(x + 6, base + 6, z, "IRON_BLOCK");
  }

  private void gardens(Cuboid area) {
    for (var x = area.min().x() + 11; x <= area.max().x() - 10; x += 6) {
      var z = area.min().z() + 11;
      var base = RustworksBlueprint.elevation(x, z);
      for (var dx = -2; dx <= 2; dx++) {
        for (var dz = -2; dz <= 2; dz++) {
          put(x + dx, base, z + dz, "MOSS_BLOCK");
          if (Math.abs(dx) + Math.abs(dz) < 4)
            put(
                x + dx,
                base + 5,
                z + dz,
                "minecraft:oak_leaves[distance=1,persistent=true,waterlogged=false]");
        }
      }
      for (var y = base + 1; y <= base + 4; y++) put(x, y, z, "OAK_LOG");
    }
  }

  private void lights(Cuboid area) {
    for (var z : new int[] {area.min().z() + 6, area.max().z() - 6}) {
      var x = area.min().x() + 2;
      var base = RustworksBlueprint.elevation(x, z);
      for (var y = base + 1; y <= base + 3; y++) put(x, y, z, "IRON_BARS");
      put(x, base + 4, z, "LANTERN");
    }
  }

  private void put(int x, int y, int z, String material) {
    var pos = new BlockPos(x, y, z);
    if (!content.arena().region().contains(pos))
      throw new IllegalArgumentException("Landmark exceeds protected footprint: " + pos);
    blocks.put(pos, material);
  }
}
