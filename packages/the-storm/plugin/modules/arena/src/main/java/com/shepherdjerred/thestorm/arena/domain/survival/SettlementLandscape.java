package com.shepherdjerred.thestorm.arena.domain.survival;

import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import java.util.LinkedHashMap;
import java.util.Map;

/** Connected low docks and high terraces, entirely inside the existing reviewed footprint. */
final class SettlementLandscape {
  private final SurvivalContent content;
  private final Map<BlockPos, String> blocks = new LinkedHashMap<>();

  SettlementLandscape(SurvivalContent content) {
    this.content = content;
  }

  Map<BlockPos, String> blocks() {
    for (var id : new String[] {"wharf", "bluff"}) {
      var zone = content.zones().stream().filter(z -> z.id().equals(id)).findFirst().orElseThrow();
      for (var area : zone.areas()) {
        box(
            new BlockPos(area.min().x(), 62, area.min().z()),
            new BlockPos(area.max().x(), 72, area.max().z()),
            "DEEPSLATE_BRICKS");
        box(
            new BlockPos(area.min().x(), 73, area.min().z()),
            new BlockPos(area.max().x(), 98, area.max().z()),
            "AIR");
        box(
            new BlockPos(area.min().x(), 72, area.min().z()),
            new BlockPos(area.max().x(), 72, area.max().z()),
            "STONE_BRICKS");
        border(area.min().x(), area.min().z(), area.max().x(), area.max().z());
      }
    }
    wharf();
    bluff();
    rampartGallery();
    return blocks;
  }

  private void wharf() {
    box(new BlockPos(1752, 65, 2261), new BlockPos(1771, 65, 2281), "DARK_OAK_PLANKS");
    box(new BlockPos(1752, 66, 2261), new BlockPos(1771, 82, 2281), "AIR");
    box(new BlockPos(1772, 62, 2266), new BlockPos(1778, 62, 2281), "DEEPSLATE_TILES");
    box(new BlockPos(1772, 63, 2266), new BlockPos(1778, 67, 2281), "AIR");
    box(new BlockPos(1772, 68, 2267), new BlockPos(1778, 68, 2281), "TUFF_BRICKS");
    stair(new Flight(1755, 2258, 72, -1, 7, "DARK_OAK_PLANKS"));
    stair(new Flight(1773, 2256, 72, -1, 10, "DEEPSLATE_BRICKS"));
    for (var z = 2268; z <= 2278; z += 5) {
      box(new BlockPos(1753, 66, z), new BlockPos(1753, 69, z), "STRIPPED_SPRUCE_LOG");
      box(new BlockPos(1753, 70, z), new BlockPos(1769, 70, z), "SPRUCE_LOG");
      put(1754, 69, z, "LANTERN");
      put(1768, 66, z + 1, "BARREL");
    }
    box(new BlockPos(1754, 66, 2279), new BlockPos(1763, 69, 2279), "BRICKS");
    box(new BlockPos(1758, 66, 2279), new BlockPos(1760, 68, 2279), "AIR");
    for (var x = 1773; x <= 1777; x += 2) put(x, 66, 2280, "SOUL_LANTERN");
    approach(1755, 1775);
  }

  private void bluff() {
    approach(1787, 1807);
    box(new BlockPos(1784, 73, 2267), new BlockPos(1811, 84, 2281), "TUFF_BRICKS");
    box(new BlockPos(1784, 85, 2267), new BlockPos(1811, 98, 2281), "AIR");
    box(new BlockPos(1784, 84, 2267), new BlockPos(1811, 84, 2281), "MOSSY_STONE_BRICKS");
    stair(new Flight(1787, 2255, 72, 1, 12, "STONE_BRICKS"));
    stair(new Flight(1805, 2255, 72, 1, 12, "STONE_BRICKS"));
    box(new BlockPos(1795, 85, 2277), new BlockPos(1804, 87, 2281), "WHITE_TERRACOTTA");
    stair(new Flight(1797, 2273, 84, 1, 3, "SMOOTH_QUARTZ"));
    box(new BlockPos(1797, 87, 2276), new BlockPos(1800, 87, 2277), "SMOOTH_QUARTZ");
    for (var y = 88; y <= 99; y++) {
      var material = y % 4 < 2 ? "WHITE_TERRACOTTA" : "RED_TERRACOTTA";
      for (var x = 1795; x <= 1804; x++) {
        put(x, y, 2281, material);
        put(x, y, 2277, material);
      }
      box(new BlockPos(1795, y, 2277), new BlockPos(1795, y, 2281), material);
      box(new BlockPos(1804, y, 2277), new BlockPos(1804, y, 2281), material);
    }
    box(new BlockPos(1797, 88, 2277), new BlockPos(1800, 91, 2277), "AIR");
    box(new BlockPos(1795, 92, 2279), new BlockPos(1795, 94, 2279), "GLASS_PANE");
    box(new BlockPos(1804, 92, 2279), new BlockPos(1804, 94, 2279), "GLASS_PANE");
    box(new BlockPos(1795, 100, 2277), new BlockPos(1804, 100, 2281), "DARK_PRISMARINE");
    for (var x = 1785; x <= 1810; x += 5) {
      put(x, 85, 2281, "STONE_BRICK_WALL");
      put(x, 86, 2281, "LANTERN");
    }
  }

  private void rampartGallery() {
    stair(new Flight(1788, 2225, 72, 1, 15, "STONE_BRICKS"));
    box(new BlockPos(1788, 87, 2240), new BlockPos(1805, 87, 2243), "STONE_BRICKS");
    box(new BlockPos(1788, 88, 2240), new BlockPos(1805, 92, 2243), "AIR");
    box(new BlockPos(1798, 87, 2237), new BlockPos(1805, 87, 2249), "STONE_BRICKS");
    box(new BlockPos(1798, 88, 2237), new BlockPos(1805, 92, 2249), "AIR");
    for (var z = 2237; z <= 2249; z++) {
      put(1805, 88, z, "STONE_BRICK_WALL");
      if (z % 4 == 0) put(1805, 89, z, "LANTERN");
    }
  }

  private void approach(int first, int second) {
    for (var x : new int[] {first, second}) {
      box(new BlockPos(x, 72, 2248), new BlockPos(x + 2, 72, 2256), "STONE_BRICKS");
      box(new BlockPos(x, 73, 2248), new BlockPos(x + 2, 78, 2256), "AIR");
    }
  }

  private record Flight(int x, int z, int floor, int rise, int length, String material) {}

  private void stair(Flight flight) {
    var x = flight.x();
    var z = flight.z();
    var floor = flight.floor();
    var rise = flight.rise();
    var length = flight.length();
    var material = flight.material();
    var stairMaterial =
        switch (material) {
          case "DARK_OAK_PLANKS" -> "dark_oak";
          case "SMOOTH_QUARTZ" -> "quartz";
          case "DEEPSLATE_BRICKS" -> "deepslate_brick";
          case "STONE_BRICKS" -> "stone_brick";
          default -> throw new IllegalArgumentException("No stair material for " + material);
        };
    var facing = rise > 0 ? "south" : "north";
    var stairs =
        "minecraft:"
            + stairMaterial
            + "_stairs[facing="
            + facing
            + ",half=bottom,shape=straight,waterlogged=false]";
    for (var step = 0; step <= length; step++) {
      var y = floor + rise * step;
      if (rise > 0 && y > floor)
        box(new BlockPos(x, floor, z + step), new BlockPos(x + 3, y - 1, z + step), material);
      box(
          new BlockPos(x, y, z + step),
          new BlockPos(x + 3, y, z + step),
          step == 0 || step == length ? material : stairs);
      box(
          new BlockPos(x, y + 1, z + step),
          new BlockPos(x + 3, Math.max(78, y + 5), z + step),
          "AIR");
    }
  }

  private void border(int x1, int z1, int x2, int z2) {
    box(new BlockPos(x1, 73, z1), new BlockPos(x2, 80, z1), "STONE_BRICKS");
    box(new BlockPos(x1, 73, z2), new BlockPos(x2, 88, z2), "MOSSY_STONE_BRICKS");
    box(new BlockPos(x1, 73, z1), new BlockPos(x1, 88, z2), "STONE_BRICKS");
    box(new BlockPos(x2, 73, z1), new BlockPos(x2, 88, z2), "STONE_BRICKS");
  }

  private void box(BlockPos min, BlockPos max, String material) {
    for (var x = min.x(); x <= max.x(); x++)
      for (var y = min.y(); y <= max.y(); y++)
        for (var z = min.z(); z <= max.z(); z++) put(x, y, z, material);
  }

  private void put(int x, int y, int z, String material) {
    var pos = new BlockPos(x, y, z);
    if (!content.arena().region().contains(pos))
      throw new IllegalArgumentException("Landscape exceeds footprint " + pos);
    blocks.put(pos, material);
  }
}
