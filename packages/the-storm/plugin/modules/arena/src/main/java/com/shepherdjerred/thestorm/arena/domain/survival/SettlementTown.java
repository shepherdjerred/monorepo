package com.shepherdjerred.thestorm.arena.domain.survival;

import static com.shepherdjerred.thestorm.arena.domain.survival.SettlementBlocks.at;

/** Small homes, working harbors and courtyard buildings sit beneath the cathedral skyline. */
final class SettlementTown {
  private record Home(
      int x, int z, int width, int depth, int floor, int height, String wall, String roof) {}

  private final SettlementBlocks build;

  SettlementTown(SettlementBlocks build) {
    this.build = build;
  }

  void apply() {
    harbor();
    market();
    cloister();
    infirmary();
    gardens();
    foundry();
    quarry();
    fortress();
    wharf();
    airstrip();
    streetLights();
  }

  private void harbor() {
    house(new Home(1758, 2261, 12, 9, 72, 6, "WHITE_TERRACOTTA", "DARK_OAK_PLANKS"));
    house(new Home(1763, 2245, 9, 10, 72, 5, "MUD_BRICKS", "DEEPSLATE_TILES"));
    house(new Home(1748, 2274, 12, 8, 72, 5, "BRICKS", "SPRUCE_PLANKS"));
    tower(new Tower(1764, 2273, 6, 72, 13));
    arch(1766, 2246, 72, 6);
    build.box(at(1770, 73, 2277), at(1772, 74, 2279), "BARREL");
    build.box(at(1744, 72, 2263), at(1748, 72, 2270), "DARK_OAK_PLANKS");
  }

  private void market() {
    house(new Home(1779, 2244, 10, 10, 72, 7, "WHITE_TERRACOTTA", "DEEPSLATE_TILES"));
    house(new Home(1804, 2243, 9, 12, 72, 6, "TERRACOTTA", "DARK_OAK_PLANKS"));
    house(new Home(1780, 2274, 12, 8, 72, 5, "BRICKS", "SPRUCE_PLANKS"));
    house(new Home(1802, 2272, 10, 10, 72, 8, "MUD_BRICKS", "DEEPSLATE_TILES"));
    for (var x : new int[] {1781, 1790, 1805})
      stall(x, 2265, 72, x == 1790 ? "RED_WOOL" : "YELLOW_WOOL");
    well(1798, 2276, 72);
    build.tree(1810, 2259, 72);
  }

  private void house(Home home) {
    var x2 = home.x() + home.width() - 1;
    var z2 = home.z() + home.depth() - 1;
    var top = home.floor() + home.height();
    build.shell(at(home.x(), home.floor(), home.z()), at(x2, top, z2), home.wall());
    for (var x : new int[] {home.x(), x2})
      for (var z : new int[] {home.z(), z2})
        build.box(at(x, home.floor() + 1, z), at(x, top, z), "STRIPPED_SPRUCE_LOG");
    build.roof(at(home.x() - 1, top + 1, home.z() - 1), at(x2 + 1, top + 1, z2 + 1), home.roof());
    var middle = (home.x() + x2) / 2;
    build.door(at(middle - 1, home.floor(), home.z()), at(middle + 1, home.floor(), home.z()));
    build.door(at(middle - 1, home.floor(), z2), at(middle + 1, home.floor(), z2));
    build.door(
        at(home.x(), home.floor(), (home.z() + z2) / 2 - 1),
        at(home.x(), home.floor(), (home.z() + z2) / 2 + 1));
    build.door(
        at(x2, home.floor(), (home.z() + z2) / 2 - 1),
        at(x2, home.floor(), (home.z() + z2) / 2 + 1));
    windows(home, x2, z2);
    build.box(at(x2 - 2, top + 1, home.z() + 2), at(x2 - 1, top + 6, home.z() + 3), "BRICKS");
    build.put(home.x() + 2, home.floor() + 1, home.z() + 2, "BARREL");
    build.put(x2 - 2, home.floor() + 1, z2 - 2, "BOOKSHELF");
    for (var z : new int[] {home.z() + 2, z2 - 2}) {
      build.box(at(home.x(), top, z), at(x2, top, z), "STRIPPED_SPRUCE_LOG");
      build.put(middle, top - 1, z, "minecraft:lantern[hanging=true]");
    }
    build.box(
        at(home.x() + 1, home.floor() + 2, z2 + 1),
        at(home.x() + 2, home.floor() + 2, z2 + 1),
        "OAK_TRAPDOOR");
  }

  private void windows(Home home, int x2, int z2) {
    for (var z = home.z() + 2; z <= z2 - 2; z += 4) {
      build.box(
          at(home.x(), home.floor() + 2, z),
          at(home.x(), home.floor() + 3, z + 1),
          "LIGHT_GRAY_STAINED_GLASS");
      build.box(
          at(x2, home.floor() + 2, z), at(x2, home.floor() + 3, z + 1), "LIGHT_GRAY_STAINED_GLASS");
      build.put(home.x() - 1, home.floor() + 1, z, "SPRUCE_TRAPDOOR");
      build.put(x2 + 1, home.floor() + 1, z, "SPRUCE_TRAPDOOR");
    }
  }

  private void stall(int x, int z, int floor, String color) {
    for (var dx : new int[] {0, 5}) {
      build.box(at(x + dx, floor + 1, z), at(x + dx, floor + 3, z), "SPRUCE_FENCE");
      build.box(at(x + dx, floor + 1, z + 3), at(x + dx, floor + 3, z + 3), "SPRUCE_FENCE");
    }
    build.box(at(x, floor + 4, z), at(x + 5, floor + 4, z + 3), color);
    build.box(at(x + 1, floor + 1, z + 2), at(x + 4, floor + 1, z + 2), "BARREL");
  }

  private void cloister() {
    for (var z = 2197; z <= 2229; z += 8) {
      arch(1748, z, 88, 6);
      build.box(at(1747, 96, z), at(1756, 96, z + 6), "DEEPSLATE_TILES");
    }
    house(new Home(1761, 2195, 12, 10, 88, 6, "CALCITE", "DEEPSLATE_TILES"));
    house(new Home(1762, 2220, 10, 9, 88, 5, "WHITE_TERRACOTTA", "DARK_OAK_PLANKS"));
    well(1763, 2213, 88);
    build.tree(1759, 2231, 88);
  }

  private void infirmary() {
    house(new Home(1747, 2172, 12, 14, 88, 7, "CALCITE", "DARK_OAK_PLANKS"));
    house(new Home(1763, 2174, 9, 11, 88, 5, "WHITE_TERRACOTTA", "SPRUCE_PLANKS"));
    for (var z = 2175; z <= 2183; z += 4) {
      build.box(at(1750, 89, z), at(1752, 89, z), "WHITE_WOOL");
      build.put(1753, 89, z, "BARREL");
      build.put(1753, 90, z, "LANTERN");
    }
  }

  private void gardens() {
    for (var x : new int[] {1749, 1770}) for (var z : new int[] {2149, 2162}) build.tree(x, z, 88);
    well(1760, 2156, 88);
    build.box(at(1748, 89, 2156), at(1753, 89, 2157), "MOSS_BLOCK");
    build.box(at(1767, 89, 2157), at(1772, 89, 2158), "MOSS_BLOCK");
    house(new Home(1763, 2147, 9, 7, 88, 4, "MUD_BRICKS", "SPRUCE_PLANKS"));
  }

  private void foundry() {
    house(new Home(1835, 2187, 11, 15, 88, 9, "BRICKS", "WAXED_CUT_COPPER"));
    house(new Home(1849, 2195, 11, 12, 88, 6, "MUD_BRICKS", "DARK_OAK_PLANKS"));
    for (var x : new int[] {1837, 1842}) {
      build.box(at(x, 89, 2189), at(x + 1, 106, 2190), "BRICKS");
      build.box(at(x, 107, 2189), at(x + 1, 107, 2190), "STONE_BRICK_WALL");
    }
    for (var z = 2190; z <= 2199; z += 3) build.put(1836, 89, z, "BLAST_FURNACE");
    build.box(at(1826, 92, 2188), at(1832, 92, 2195), "WAXED_COPPER_GRATE");
    for (var x : new int[] {1826, 1832})
      build.box(at(x, 89, 2188), at(x, 91, 2188), "POLISHED_ANDESITE");
  }

  private void quarry() {
    house(new Home(1837, 2221, 12, 10, 88, 5, "TUFF_BRICKS", "SPRUCE_PLANKS"));
    house(new Home(1852, 2217, 8, 12, 88, 6, "BRICKS", "DARK_OAK_PLANKS"));
    for (var z = 2236; z <= 2250; z += 4) {
      build.box(at(1843, 73, z), at(1860, 76, z + 2), "TUFF");
      build.box(at(1847, 77, z), at(1853, 77, z + 2), "IRON_ORE");
    }
    build.box(at(1856, 89, 2234), at(1857, 101, 2235), "STRIPPED_SPRUCE_LOG");
    build.box(at(1844, 101, 2234), at(1857, 101, 2235), "STRIPPED_SPRUCE_LOG");
    build.box(at(1844, 95, 2234), at(1844, 100, 2234), "IRON_CHAIN");
    build.put(1844, 94, 2234, "IRON_BLOCK");
  }

  private void fortress() {
    house(new Home(1787, 2149, 16, 12, 104, 8, "STONE_BRICKS", "DEEPSLATE_TILES"));
    house(new Home(1789, 2166, 13, 12, 104, 6, "MUD_BRICKS", "DARK_OAK_PLANKS"));
    tower(new Tower(1809, 2146, 8, 104, 14));
    tower(new Tower(1836, 2146, 8, 104, 11));
    arch(1819, 2159, 104, 8);
    build.box(at(1817, 111, 2148), at(1835, 111, 2151), "STONE_BRICKS");
    for (var x = 1818; x <= 1833; x += 5)
      build.box(at(x, 105, 2149), at(x + 1, 110, 2150), "STONE_BRICKS");
    tower(new Tower(1833, 2171, 9, 104, 19));
    house(new Home(1826, 2167, 8, 8, 104, 5, "WHITE_TERRACOTTA", "DEEPSLATE_TILES"));
    for (var x = 1827; x <= 1841; x += 4) build.put(x, 105, 2180, "HAY_BLOCK");
  }

  private void wharf() {
    house(new Home(1820, 2260, 13, 8, 72, 7, "MUD_BRICKS", "DARK_OAK_PLANKS"));
    house(new Home(1840, 2273, 17, 9, 72, 6, "BRICKS", "SPRUCE_PLANKS"));
    build.box(at(1840, 72, 2259), at(1860, 72, 2265), "DARK_OAK_PLANKS");
    for (var x = 1842; x <= 1857; x += 5) build.box(at(x, 73, 2261), at(x + 1, 74, 2262), "BARREL");
    build.box(at(1855, 73, 2268), at(1855, 80, 2268), "SPRUCE_LOG");
    build.box(at(1856, 76, 2268), at(1860, 79, 2268), "WHITE_WOOL");
  }

  private void airstrip() {
    build.box(at(1850, 104, 2147), at(1861, 104, 2158), "STONE_BRICKS");
    for (var z = 2148; z <= 2156; z += 3)
      build.box(at(1855, 104, z), at(1856, 104, z), "WHITE_CONCRETE");
    build.box(at(1852, 105, 2151), at(1859, 105, 2153), "IRON_BARS");
    build.box(at(1855, 105, 2148), at(1856, 106, 2157), "WAXED_COPPER_BLOCK");
    build.put(1855, 107, 2150, "LIGHT_BLUE_STAINED_GLASS");
  }

  private record Tower(int x, int z, int width, int floor, int height) {}

  private void tower(Tower tower) {
    var x = tower.x();
    var z = tower.z();
    var width = tower.width();
    var floor = tower.floor();
    var height = tower.height();
    build.shell(at(x, floor, z), at(x + width - 1, floor + height, z + width - 1), "STONE_BRICKS");
    build.box(
        at(x, floor + height, z), at(x + width - 1, floor + height, z + width - 1), "STONE_BRICKS");
    for (var dx = 0; dx < width; dx += 2) {
      build.put(x + dx, floor + height + 1, z, "STONE_BRICKS");
      build.put(x + dx, floor + height + 1, z + width - 1, "STONE_BRICKS");
    }
    build.door(at(x + width / 2 - 1, floor, z), at(x + width / 2 + 1, floor, z));
    build.door(
        at(x + width / 2 - 1, floor, z + width - 1), at(x + width / 2 + 1, floor, z + width - 1));
    build.put(x + width / 2, floor + height - 1, z + width / 2, "minecraft:lantern[hanging=true]");
    build.put(x + width / 2, floor, z + width / 2, "SEA_LANTERN");
  }

  private void arch(int x, int z, int floor, int width) {
    for (var dx : new int[] {0, width})
      build.box(at(x + dx, floor + 1, z), at(x + dx, floor + 6, z + 1), "POLISHED_ANDESITE");
    build.box(at(x, floor + 7, z), at(x + width, floor + 7, z + 1), "STONE_BRICKS");
    build.box(at(x + 1, floor + 6, z), at(x + 1, floor + 6, z + 1), "STONE_BRICKS");
    build.box(at(x + width - 1, floor + 6, z), at(x + width - 1, floor + 6, z + 1), "STONE_BRICKS");
  }

  private void well(int x, int z, int floor) {
    build.box(at(x - 2, floor, z - 2), at(x + 2, floor, z + 2), "MOSSY_STONE_BRICKS");
    build.put(x, floor + 1, z, "WATER_CAULDRON");
    for (var dx : new int[] {-2, 2})
      build.box(at(x + dx, floor + 1, z), at(x + dx, floor + 6, z), "SPRUCE_FENCE");
    build.roof(at(x - 3, floor + 5, z - 2), at(x + 3, floor + 5, z + 2), "DARK_OAK_PLANKS");
  }

  private void streetLights() {
    for (var point :
        new int[][] {
          {1754, 2258},
          {1767, 2263},
          {1778, 2258},
          {1810, 2268},
          {1757, 2195},
          {1771, 2210},
          {1786, 2237},
          {1818, 2237},
          {1834, 2232},
          {1852, 2209},
          {1785, 2167},
          {1805, 2158},
          {1828, 2158},
          {1846, 2167}
        }) build.lamp(point[0], point[1], SettlementTerrain.elevation(point[0], point[1]));
  }
}
