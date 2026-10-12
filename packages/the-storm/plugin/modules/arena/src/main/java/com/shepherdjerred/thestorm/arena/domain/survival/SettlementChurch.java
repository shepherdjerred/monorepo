package com.shepherdjerred.thestorm.arena.domain.survival;

import static com.shepherdjerred.thestorm.arena.domain.survival.SettlementBlocks.at;

/** A spacious vaulted nave, connected galleries, bell tower and separately entered undercroft. */
final class SettlementChurch {
  private final SettlementBlocks build;

  SettlementChurch(SettlementBlocks build) {
    this.build = build;
  }

  void apply() {
    nave();
    buttresses();
    windows();
    galleries();
    roofs();
    bellTower();
    crypt();
    entrances();
  }

  private void nave() {
    build.shell(at(1784, 88, 2184), at(1823, 108, 2235), "STONE_BRICKS");
    for (var x = 1785; x <= 1822; x++)
      for (var z = 2185; z <= 2234; z++)
        build.put(x, 88, z, (x + z) % 8 == 0 ? "POLISHED_ANDESITE" : "CALCITE");
    vaults();
    build.box(at(1796, 89, 2187), at(1811, 89, 2190), "POLISHED_DEEPSLATE");
    build.box(at(1801, 90, 2188), at(1806, 91, 2189), "CHISELED_STONE_BRICKS");
    lighting();
  }

  private void vaults() {
    for (var z = 2193; z <= 2225; z += 8) {
      for (var x : new int[] {1788, 1819}) {
        build.box(at(x, 89, z), at(x + 1, 107, z + 1), "POLISHED_ANDESITE");
        build.box(at(x - 1, 89, z - 1), at(x + 2, 90, z + 2), "CHISELED_STONE_BRICKS");
      }
      build.box(at(1788, 107, z), at(1793, 108, z), "CALCITE");
      build.box(at(1815, 107, z), at(1820, 108, z), "CALCITE");
      for (var rise = 0; rise <= 12; rise++) {
        build.box(
            at(1792 + rise, 107 + rise / 2, z), at(1792 + rise, 108 + rise / 2, z), "CALCITE");
        build.box(
            at(1816 - rise, 107 + rise / 2, z), at(1816 - rise, 108 + rise / 2, z), "CALCITE");
      }
    }
  }

  private void lighting() {
    for (var z : new int[] {2198, 2214, 2230})
      for (var x : new int[] {1796, 1810}) {
        build.box(at(x, 96, z), at(x, 111 + Math.min(x - 1790, 1817 - x), z), "IRON_CHAIN");
        build.put(x, 95, z, "minecraft:lantern[hanging=true]");
      }
    for (var z = 2194; z <= 2232; z += 7) {
      build.box(at(1784, 94, z), at(1786, 94, z), "STRIPPED_SPRUCE_LOG");
      build.box(at(1821, 94, z), at(1823, 94, z), "STRIPPED_SPRUCE_LOG");
      build.put(1786, 93, z, "minecraft:lantern[hanging=true]");
      build.put(1821, 93, z, "minecraft:lantern[hanging=true]");
    }
  }

  private void buttresses() {
    for (var z = 2187; z <= 2234; z += 8)
      for (var x : new int[] {1782, 1824}) {
        build.box(at(x, 88, z), at(x + 1, 101, z + 2), "STONE_BRICKS");
        build.box(at(x, 102, z + 1), at(x + 1, 104, z + 2), "POLISHED_ANDESITE");
        build.put(x, 105, z + 1, "STONE_BRICK_WALL");
      }
    build.box(at(1784, 98, 2184), at(1823, 98, 2184), "CHISELED_STONE_BRICKS");
    build.box(at(1784, 98, 2235), at(1823, 98, 2235), "CHISELED_STONE_BRICKS");
  }

  private void windows() {
    for (var z = 2196; z <= 2228; z += 8)
      for (var x : new int[] {1784, 1823}) {
        build.box(at(x, 94, z), at(x, 105, z + 2), "LIGHT_BLUE_STAINED_GLASS");
        build.box(at(x, 96, z + 1), at(x, 103, z + 1), "BLUE_STAINED_GLASS");
        build.put(x, 101, z + 1, "YELLOW_STAINED_GLASS");
      }
    for (var dx = -5; dx <= 5; dx++)
      for (var dy = -5; dy <= 5; dy++)
        if (dx * dx + dy * dy <= 26)
          build.put(
              1803 + dx,
              104 + dy,
              2235,
              Math.abs(dx) == Math.abs(dy) ? "YELLOW_STAINED_GLASS" : "BLUE_STAINED_GLASS");
  }

  private void galleries() {
    build.box(at(1786, 100, 2194), at(1789, 100, 2227), "DARK_OAK_PLANKS");
    build.box(at(1819, 100, 2194), at(1822, 100, 2227), "DARK_OAK_PLANKS");
    build.box(at(1786, 100, 2194), at(1822, 100, 2197), "DARK_OAK_PLANKS");
    for (var z = 2198; z <= 2227; z++) {
      build.put(1789, 101, z, "SPRUCE_FENCE");
      build.put(1819, 101, z, "SPRUCE_FENCE");
    }
    for (var step = 0; step <= 24; step++) {
      var floor = 88 + step / 2;
      build.box(at(1786, 88, 2233 - step), at(1789, floor, 2233 - step), "DARK_OAK_PLANKS");
      build.box(at(1786, floor + 1, 2233 - step), at(1789, floor + 4, 2233 - step), "AIR");
      build.box(at(1819, 88, 2187 + step), at(1822, floor, 2187 + step), "DARK_OAK_PLANKS");
      build.box(at(1819, floor + 1, 2187 + step), at(1822, floor + 4, 2187 + step), "AIR");
    }
    build.box(at(1786, 101, 2208), at(1789, 104, 2210), "AIR");
    build.box(at(1819, 101, 2210), at(1822, 104, 2212), "AIR");
    for (var z : new int[] {2199, 2206}) build.put(1787, 100, z, "SEA_LANTERN");
    for (var z : new int[] {2218, 2225}) build.put(1821, 100, z, "SEA_LANTERN");
  }

  private void roofs() {
    build.roof(at(1790, 112, 2183), at(1817, 112, 2236), "DEEPSLATE_TILES");
    build.roof(at(1783, 107, 2183), at(1790, 107, 2236), "DEEPSLATE_TILES");
    build.roof(at(1817, 107, 2183), at(1824, 107, 2236), "DEEPSLATE_TILES");
    gables();
    build.box(at(1791, 109, 2185), at(1791, 111, 2234), "LIGHT_GRAY_STAINED_GLASS");
    build.box(at(1816, 109, 2185), at(1816, 111, 2234), "LIGHT_GRAY_STAINED_GLASS");
    for (var z = 2199; z <= 2214; z++)
      for (var x = 1782; x <= 1825; x++)
        build.put(x, 112 + Math.min(z - 2199, 2214 - z), z, "DEEPSLATE_TILES");
  }

  private void gables() {
    for (var z : new int[] {2183, 2236}) {
      var inner = z == 2183 ? 2184 : 2235;
      build.box(
          at(1790, 108, Math.min(z, inner)), at(1817, 108, Math.max(z, inner)), "STONE_BRICKS");
      for (var x = 1790; x <= 1817; x++) {
        var roof = 112 + Math.min(x - 1790, 1817 - x);
        build.box(at(x, 109, z), at(x, roof - 1, z), "STONE_BRICKS");
        build.put(x, roof - 1, z, "CALCITE");
      }
    }
  }

  private void bellTower() {
    build.shell(at(1784, 88, 2184), at(1793, 126, 2193), "STONE_BRICKS");
    for (var y : new int[] {101, 113, 124}) {
      build.box(at(1783, y, 2183), at(1794, y, 2194), "CHISELED_STONE_BRICKS");
      build.put(1788, y, 2188, "SEA_LANTERN");
    }
    for (var y = 118; y <= 123; y++) {
      build.box(at(1786, y, 2184), at(1791, y, 2184), "IRON_BARS");
      build.box(at(1786, y, 2193), at(1791, y, 2193), "IRON_BARS");
      build.box(at(1784, y, 2186), at(1784, y, 2191), "IRON_BARS");
      build.box(at(1793, y, 2186), at(1793, y, 2191), "IRON_BARS");
    }
    build.put(1788, 121, 2188, "GOLD_BLOCK");
    build.box(at(1788, 122, 2188), at(1788, 125, 2188), "IRON_CHAIN");
    build.box(at(1784, 126, 2188), at(1793, 126, 2188), "STRIPPED_SPRUCE_LOG");
    for (var inset = 0; inset <= 5; inset++)
      build.box(
          at(1783 + inset, 127 + inset * 2, 2183 + inset),
          at(1794 - inset, 128 + inset * 2, 2194 - inset),
          "DEEPSLATE_TILES");
    build.box(at(1788, 139, 2188), at(1788, 141, 2188), "IRON_BARS");
    build.put(1788, 140, 2187, "IRON_BARS");
    build.put(1788, 140, 2189, "IRON_BARS");
  }

  private void crypt() {
    build.shell(at(1784, 76, 2192), at(1815, 82, 2227), "DEEPSLATE_BRICKS");
    build.box(at(1784, 82, 2192), at(1815, 82, 2227), "DEEPSLATE_TILES");
    for (var x = 1787; x <= 1813; x += 7)
      for (var z = 2195; z <= 2224; z += 7) {
        build.put(x, 81, z, "IRON_CHAIN");
        build.put(x, 80, z, "minecraft:soul_lantern[hanging=true]");
      }
    for (var z = 2197; z <= 2225; z += 7) {
      build.box(at(1791, 77, z), at(1792, 81, z + 1), "CHISELED_DEEPSLATE");
      build.box(at(1807, 77, z), at(1808, 81, z + 1), "CHISELED_DEEPSLATE");
      build.put(1786, 81, z, "IRON_CHAIN");
      build.put(1813, 81, z, "IRON_CHAIN");
      build.put(1786, 80, z, "minecraft:soul_lantern[hanging=true]");
      build.put(1813, 80, z, "minecraft:soul_lantern[hanging=true]");
    }
    for (var z = 2200; z <= 2227; z++) {
      var floor = 76 + Math.clamp((z - 2203) / 2, 0, 12);
      build.box(at(1776, floor, z), at(1783, floor, z), "DEEPSLATE_BRICKS");
      build.box(at(1777, floor + 1, z), at(1782, floor + 5, z), "AIR");
      build.box(at(1776, floor + 1, z), at(1776, floor + 5, z), "DEEPSLATE_BRICKS");
      build.box(at(1783, floor + 1, z), at(1783, floor + 5, z), "DEEPSLATE_BRICKS");
      build.box(at(1776, floor + 6, z), at(1783, floor + 6, z), "DEEPSLATE_TILES");
      if (z % 6 == 0) build.put(1779, floor + 5, z, "minecraft:soul_lantern[hanging=true]");
    }
    build.door(at(1783, 76, 2200), at(1784, 76, 2204));
    build.door(at(1783, 88, 2226), at(1784, 88, 2227));
    build.box(at(1776, 89, 2228), at(1783, 94, 2228), "DEEPSLATE_BRICKS");
  }

  private void entrances() {
    build.door(at(1784, 88, 2188), at(1793, 88, 2191));
    for (var x = 1784; x <= 1787; x++)
      for (var z = 2188; z <= 2191; z++) build.put(x, 88 + (1787 - x) / 2, z, "STONE_BRICKS");
    build.door(at(1793, 88, 2235), at(1802, 88, 2235));
    build.door(at(1784, 88, 2194), at(1784, 88, 2199));
    build.door(at(1823, 88, 2210), at(1823, 88, 2215));
    build.door(at(1802, 88, 2184), at(1807, 88, 2184));
    build.box(at(1792, 93, 2235), at(1803, 93, 2236), "CHISELED_STONE_BRICKS");
    build.box(at(1794, 94, 2235), at(1801, 94, 2236), "CALCITE");
  }
}
