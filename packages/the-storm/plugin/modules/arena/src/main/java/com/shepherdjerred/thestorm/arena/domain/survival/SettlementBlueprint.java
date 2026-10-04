package com.shepherdjerred.thestorm.arena.domain.survival;

import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.arena.domain.geometry.Cuboid;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Authored ruined harbor: asymmetric streets, eight landmarks, interiors, caves and an airstrip.
 */
public final class SettlementBlueprint {
  public static final int BLOCK_BUDGET = 550_000;
  private static final int X = 1750;
  private static final int Z = 2140;
  private static final int FLOOR = 72;
  private final Map<BlockPos, String> blocks = new LinkedHashMap<>();
  private final SurvivalContent content;

  public SettlementBlueprint(SurvivalContent content) {
    this.content = content;
  }

  public Map<BlockPos, String> blocks() {
    if (blocks.isEmpty()) build();
    return java.util.Collections.unmodifiableMap(new LinkedHashMap<>(blocks));
  }

  private void build() {
    oceanAndFoundations();
    streets();
    districtWalls();
    gatehouse();
    market();
    quarry();
    foundry();
    infirmary();
    barracks();
    ramparts();
    chapel();
    stagingDock();
    offshoreForge();
    blocks.putAll(new SettlementLandscape(content).blocks());
    new SettlementFixtures(content, blocks).apply();
    var exit = content.arena().exit().point().block();
    absolute(exit.x(), exit.y() - 1, exit.z(), "STONE_BRICKS");
    absolute(exit.x(), exit.y(), exit.z(), "AIR");
    absolute(exit.x(), exit.y() + 1, exit.z(), "AIR");
  }

  private void oceanAndFoundations() {
    ocean();
    for (var x = 0; x < 112; x++) {
      for (var z = 0; z < 112; z++) foundation(x, z);
    }
  }

  private void ocean() {
    var region = content.arena().region();
    for (var x = region.min().x(); x <= region.max().x(); x++) {
      for (var z = region.min().z(); z <= region.max().z(); z++) {
        absolute(x, FLOOR - 2, z, "WATER");
        for (var y = FLOOR - 1; y <= FLOOR + 12; y++)
          absolute(x, y, z, y == FLOOR - 1 ? "WATER" : "AIR");
      }
    }
  }

  private void foundation(int x, int z) {
    for (var y = -10; y < 0; y++) put(x, y, z, "DEEPSLATE_BRICKS");
    put(x, 0, z, (x * 17 + z * 31) % 11 < 3 ? "MOSS_BLOCK" : "COBBLESTONE");
  }

  private void streets() {
    path(7, 15, 46, 20);
    path(43, 17, 49, 46);
    path(23, 37, 47, 43);
    path(20, 37, 26, 92);
    path(24, 73, 91, 79);
    path(88, 35, 94, 105);
    path(46, 16, 89, 21);
    path(49, 30, 64, 36);
    path(54, 31, 60, 71);
    path(6, 92, 93, 98);
    for (var x = 4; x <= 108; x += 13) {
      lamp(x, 18);
      lamp(x, 76);
    }
    for (var z = 38; z < 108; z += 17) lamp(23, z);
  }

  private void path(int x1, int z1, int x2, int z2) {
    for (var x = x1; x <= x2; x++)
      for (var z = z1; z <= z2; z++)
        put(
            x,
            0,
            z,
            (x + z) % 9 == 0
                ? "CRACKED_STONE_BRICKS"
                : (x + z) % 7 == 0 ? "ANDESITE" : "STONE_BRICKS");
  }

  private void districtWalls() {
    for (var zone : content.zones()) {
      if (zone.emeralds() > 0) for (var area : zone.areas()) districtWall(zone, area);
    }
    for (var x = 0; x < 112; x++) {
      wall(X + x, Z, "perimeter");
      wall(X + x, Z + 111, "perimeter");
    }
    for (var z = 0; z < 112; z++) {
      wall(X, Z + z, "perimeter");
      wall(X + 111, Z + z, "perimeter");
    }
  }

  private void districtWall(SurvivalContent.Zone zone, Cuboid area) {
    for (var x = area.min().x(); x <= area.max().x(); x++) {
      if (!zone.contains(new BlockPos(x, FLOOR, area.min().z() - 1)))
        wall(x, area.min().z(), zone.id());
      if (!zone.contains(new BlockPos(x, FLOOR, area.max().z() + 1)))
        wall(x, area.max().z(), zone.id());
    }
    for (var z = area.min().z(); z <= area.max().z(); z++) {
      if (!zone.contains(new BlockPos(area.min().x() - 1, FLOOR, z)))
        wall(area.min().x(), z, zone.id());
      if (!zone.contains(new BlockPos(area.max().x() + 1, FLOOR, z)))
        wall(area.max().x(), z, zone.id());
    }
  }

  private void wall(int x, int z, String district) {
    for (var y = 1; y <= 6; y++)
      absolute(x, FLOOR + y, z, wallMaterial(new BlockPos(x, y, z), district));
  }

  private static String wallMaterial(BlockPos pos, String district) {
    var pillar = (pos.x() + pos.z()) % 9 == 0;
    if (district.equals("foundry") && pos.y() == 5) return "OXIDIZED_COPPER";
    if (district.equals("crypt") && pos.y() > 1 && pos.y() < 6)
      return pillar ? "DEEPSLATE_BRICKS" : "DEEPSLATE_TILES";
    if (pillar) return "POLISHED_ANDESITE";
    if (pos.y() == 6) return "STONE_BRICK_SLAB";
    return (pos.x() * 7 + pos.z() * 13 + pos.y()) % 8 == 0 ? "MOSSY_STONE_BRICKS" : "STONE_BRICKS";
  }

  private void gatehouse() {
    tower(1, 1, 5, 13);
    tower(15, 1, 5, 10);
    house(new House(4, 6, 12, 7, 5, "STONE_BRICKS", "DARK_OAK_LOG", "SPRUCE"), 1);
    arch(4, 23, 12, "STONE_BRICKS");
    path(5, 10, 18, 26);
    crate(6, 13);
    crate(17, 25);
    lamp(17, 10);
  }

  private void market() {
    house(new House(27, 3, 11, 10, 5, "TERRACOTTA", "STRIPPED_DARK_OAK_LOG", "DARK_OAK"), 2);
    house(new House(44, 5, 12, 11, 7, "WHITE_TERRACOTTA", "SPRUCE_LOG", "SPRUCE"), 3);
    house(new House(28, 28, 13, 9, 5, "BRICKS", "DARK_OAK_LOG", "SPRUCE"), 1);
    house(new House(45, 29, 10, 10, 4, "MUD_BRICKS", "STRIPPED_SPRUCE_LOG", "DARK_OAK"), 2);
    stall(30, 23, "YELLOW_WOOL");
    stall(38, 23, "RED_WOOL");
    stall(48, 23, "CYAN_WOOL");
    path(25, 15, 57, 26);
    fountain(42, 22);
    tree(56, 38);
    lamp(28, 19);
    lamp(51, 26);
  }

  private void quarry() {
    house(new House(64, 3, 16, 9, 5, "TUFF_BRICKS", "SPRUCE_LOG", "SPRUCE"), 1);
    mine(79, 20, 24, 15);
    for (var step = 0; step <= 6; step++) {
      for (var dx = 0; dx < 3; dx++) {
        put(82 + dx, -step, 19 + step, "STONE_BRICKS");
        clear(82 + dx, 1 - step, 19 + step, 3);
      }
    }
    path(63, 11, 108, 18);
    crane(101, 8);
    crate(89, 10);
    crate(92, 10);
    for (var x = 87; x <= 100; x += 4) {
      put(x, -5, 29, "IRON_ORE");
      put(x, -4, 34, "COPPER_ORE");
    }
    lamp(70, 18);
  }

  private void foundry() {
    house(new House(65, 45, 27, 19, 9, "BRICKS", "POLISHED_DEEPSLATE", "DARK_OAK"), 3);
    chimney(96, 45, 18);
    chimney(102, 45, 15);
    path(63, 65, 107, 79);
    for (var x = 69; x < 89; x += 5) {
      put(x, 1, 55, "BLAST_FURNACE");
      put(x, 2, 55, "IRON_BARS");
      put(x, 1, 58, "SMOOTH_STONE");
    }
    for (var x = 76; x <= 105; x++) put(x, 7, 69, "OXIDIZED_CUT_COPPER");
    for (var x : new int[] {76, 87, 98, 105}) column(x, 69, new Vertical(1, 6, "DEEPSLATE_BRICKS"));
    crate(106, 73);
    lamp(60, 65);
    lamp(96, 80);
  }

  private void infirmary() {
    house(new House(4, 37, 13, 25, 7, "WHITE_TERRACOTTA", "STRIPPED_SPRUCE_LOG", "SPRUCE"), 2);
    for (var z = 44; z < 59; z += 5) {
      put(6, 1, z, "WHITE_WOOL");
      put(7, 1, z, "WHITE_CARPET");
      put(14, 1, z, "FLOWER_POT");
      put(14, 2, z, "AIR");
    }
    path(3, 63, 18, 70);
    tree(7, 67);
    lamp(17, 36);
    bench(13, 66);
  }

  private void barracks() {
    house(new House(28, 49, 14, 20, 7, "STONE_BRICKS", "DARK_OAK_LOG", "DARK_OAK"), 1);
    house(new House(46, 48, 11, 14, 6, "MUD_BRICKS", "STRIPPED_SPRUCE_LOG", "SPRUCE"), 3);
    path(27, 70, 57, 80);
    for (var x = 31; x <= 48; x += 5) {
      put(x, 1, 75, "HAY_BLOCK");
      put(x, 2, 75, "OAK_FENCE");
      put(x, 3, 75, "CARVED_PUMPKIN");
    }
    arch(31, 44, 15, "STONE_BRICKS");
    bench(31, 78);
    lamp(43, 68);
  }

  private void ramparts() {
    path(5, 86, 57, 108);
    for (var x = 5; x <= 21; x++) for (var z = 96; z <= 108; z++) put(x, 8, z, "DARK_OAK_PLANKS");
    for (var x : new int[] {5, 21})
      for (var z = 96; z <= 108; z += 4) column(x, z, new Vertical(1, 7, "STONE_BRICKS"));
    for (var step = 0; step <= 8; step++) {
      for (var dx = 0; dx < 4; dx++) {
        put(8 + dx, step, 85 + step, "STONE_BRICKS");
        clear(8 + dx, step + 1, 85 + step, 3);
      }
    }
    for (var z = 93; z <= 97; z++)
      for (var x = 8; x <= 11; x++) {
        put(x, 8, z, "DARK_OAK_PLANKS");
        clear(x, 9, z, 3);
      }
    tower(48, 100, 7, 13);
    house(new House(26, 99, 15, 9, 5, "STONE_BRICKS", "SPRUCE_LOG", "SPRUCE"), 1);
    crane(33, 89);
    lamp(42, 95);
    // The plane's skeletal frame marks the cargo assembly and departure point.
    for (var z = 100; z <= 106; z++) put(12, 9, z, "IRON_BARS");
    put(12, 10, 100, "GLASS");
    put(12, 9, 99, "COPPER_BLOCK");
  }

  private void chapel() {
    house(new House(66, 89, 16, 19, 11, "DEEPSLATE_BRICKS", "POLISHED_BASALT", "DARK_OAK"), 3);
    tower(68, 86, 6, 17);
    mine(84, 91, 19, 14);
    for (var step = 0; step <= 6; step++) {
      for (var dx = 0; dx < 3; dx++) {
        put(88 + dx, -step, 90 + step, "DEEPSLATE_BRICKS");
        clear(88 + dx, 1 - step, 90 + step, 3);
      }
    }
    for (var x = 91; x <= 100; x += 4) {
      put(x, -5, 99, "SCULK");
      put(x, -4, 99, "SOUL_LANTERN");
    }
    path(63, 87, 84, 94);
    tree(106, 104);
    tree(106, 90);
  }

  private void stagingDock() {
    deck(content.lobbyArea(), "SPRUCE_PLANKS");
    for (var x = 1716; x <= 1736; x++)
      for (var z = 2132; z <= 2136; z++) absolute(x, 78, z, "SPRUCE_PLANKS");
    for (var x : new int[] {1716, 1736})
      for (var y = 73; y <= 77; y++) absolute(x, y, 2132, "SPRUCE_LOG");
    for (var x = 1724; x <= 1733; x++)
      for (var z = 2138; z <= 2143; z++) absolute(x, 80, z, "SPRUCE_PLANKS");
    dockStairs();
    for (var x = 1720; x <= 1728; x++)
      for (var z = 2139; z <= 2141; z++) absolute(x, 80, z, "SPRUCE_PLANKS");
  }

  private void dockStairs() {
    for (var step = 0; step <= 8; step++) {
      for (var dx = 0; dx < 3; dx++) {
        absolute(1718 + dx, 72 + step, 2149 - step, "STONE_BRICKS");
        for (var y = 73 + step; y <= 83; y++) absolute(1718 + dx, y, 2149 - step, "AIR");
      }
    }
  }

  private void offshoreForge() {
    deck(content.expedition().area(), "STONE_BRICKS");
    for (var x = 1719; x <= 1735; x++)
      for (var z = 2207; z <= 2212; z++) {
        absolute(x, 77, z, "DEEPSLATE_TILES");
        if (x == 1719 || x == 1735)
          for (var y = 73; y < 77; y++) absolute(x, y, z, "POLISHED_BASALT");
      }
    for (var x : new int[] {1720, 1734}) {
      absolute(x, 73, 2219, "IRON_CHAIN");
      absolute(x, 74, 2219, "SOUL_LANTERN");
    }
    absolute(1727, 73, 2210, "ANVIL");
  }

  private void deck(Cuboid area, String floor) {
    for (var x = area.min().x(); x <= area.max().x(); x++)
      for (var z = area.min().z(); z <= area.max().z(); z++) {
        absolute(x, FLOOR, z, floor);
        if ((x + z) % 7 == 0)
          for (var y = FLOOR - 5; y < FLOOR; y++) absolute(x, y, z, "SPRUCE_LOG");
      }
  }

  private record House(
      int x, int z, int width, int depth, int height, String wall, String beam, String roof) {}

  private void house(House h, int decor) {
    shell(h);
    roof(h);
    doors(h);
    for (var x = h.x() + 2; x < h.x() + h.width() - 2; x += 3) {
      put(x, 1, h.z() + 2, decor == 1 ? "BOOKSHELF" : decor == 2 ? "BARREL" : "POLISHED_ANDESITE");
      put(x, 3, h.z() + h.depth() - 1, "GLASS_PANE");
      put(x, 2, h.z(), "GLASS_PANE");
    }
    put(h.x() + h.width() / 2, h.height(), h.z() + h.depth() / 2, "LANTERN");
    bench(h.x() + 2, h.z() + h.depth() - 3);
    put(h.x() + h.width() - 3, 1, h.z() + 3, "CRAFTING_TABLE");
  }

  private void shell(House h) {
    for (var dx = 0; dx < h.width(); dx++)
      for (var dz = 0; dz < h.depth(); dz++) houseCell(h, dx, dz);
  }

  private void houseCell(House h, int dx, int dz) {
    put(h.x() + dx, 0, h.z() + dz, "DARK_OAK_PLANKS");
    var edge = dx == 0 || dz == 0 || dx == h.width() - 1 || dz == h.depth() - 1;
    var corner = (dx == 0 || dx == h.width() - 1) && (dz == 0 || dz == h.depth() - 1);
    for (var y = 1; y <= h.height(); y++)
      put(
          h.x() + dx,
          y,
          h.z() + dz,
          !edge ? "AIR" : corner || y == h.height() ? h.beam() : h.wall());
  }

  private void roof(House h) {
    var half = (h.width() + 1) / 2;
    for (var dx = -1; dx <= h.width(); dx++) {
      var rise = Math.min(dx + 1, h.width() - dx);
      var y = h.height() + 1 + Math.max(0, rise);
      for (var dz = -1; dz <= h.depth(); dz++) {
        put(
            h.x() + dx,
            y,
            h.z() + dz,
            "minecraft:"
                + h.roof().toLowerCase(java.util.Locale.ROOT)
                + "_stairs[facing="
                + (dx < half ? "east" : "west")
                + ",half=bottom,shape=straight,waterlogged=false]");
      }
    }
  }

  private void doors(House h) {
    for (var dx = h.width() / 2 - 1; dx <= h.width() / 2 + 1; dx++)
      for (var y = 1; y <= 3; y++) {
        put(h.x() + dx, y, h.z(), "AIR");
        put(h.x() + dx, y, h.z() + h.depth() - 1, "AIR");
      }
    for (var dz = h.depth() / 2; dz <= h.depth() / 2 + 1; dz++)
      for (var y = 1; y <= 3; y++) {
        put(h.x(), y, h.z() + dz, "AIR");
        put(h.x() + h.width() - 1, y, h.z() + dz, "AIR");
      }
  }

  private void mine(int x, int z, int width, int depth) {
    for (var dx = 0; dx < width; dx++)
      for (var dz = 0; dz < depth; dz++) {
        var edge = dx == 0 || dx == width - 1 || dz == 0 || dz == depth - 1;
        mineCell(x + dx, z + dz, edge);
      }
    for (var dz = 3; dz < depth - 2; dz += 5) {
      for (var y = -5; y <= 0; y++) {
        put(x + 2, y, z + dz, "OAK_LOG");
        put(x + width - 3, y, z + dz, "OAK_LOG");
      }
      for (var dx = 2; dx <= width - 3; dx++) put(x + dx, 0, z + dz, "OAK_LOG");
      put(x + 3, -1, z + dz, "LANTERN");
    }
  }

  private void mineCell(int x, int z, boolean edge) {
    put(x, -6, z, "DEEPSLATE_BRICKS");
    for (var y = -5; y <= 0; y++) put(x, y, z, edge ? "TUFF_BRICKS" : "AIR");
  }

  private void tower(int x, int z, int width, int height) {
    for (var dx = 0; dx < width; dx++)
      for (var dz = 0; dz < width; dz++) {
        for (var y = 1; y <= height; y++)
          put(
              x + dx,
              y,
              z + dz,
              dx == 0 || dz == 0 || dx == width - 1 || dz == width - 1
                  ? "MOSSY_STONE_BRICKS"
                  : "AIR");
        put(x + dx, height + 1, z + dz, "STONE_BRICK_SLAB");
      }
    for (var y = 1; y <= 3; y++) put(x + width / 2, y, z + width - 1, "AIR");
    for (var y = 4; y < height; y += 4) put(x, y, z + width / 2, "GLASS_PANE");
  }

  private void arch(int x, int z, int width, String stone) {
    column(x, z, new Vertical(1, 6, stone));
    column(x + width - 1, z, new Vertical(1, 6, stone));
    for (var dx = 0; dx < width; dx++) put(x + dx, dx < 3 || dx > width - 4 ? 6 : 7, z, stone);
    put(x + width / 2, 6, z, "LANTERN");
  }

  private void chimney(int x, int z, int height) {
    for (var dx = 0; dx <= 2; dx++)
      for (var dz = 0; dz <= 2; dz++) {
        column(x + dx, z + dz, new Vertical(1, height, (dx == 1 && dz == 1) ? "AIR" : "BRICKS"));
        put(x + dx, height + 1, z + dz, "BRICK_WALL");
      }
  }

  private void crane(int x, int z) {
    column(x, z, new Vertical(1, 10, "STRIPPED_SPRUCE_LOG"));
    for (var dx = 0; dx <= 7; dx++) put(x - dx, 10, z, "SPRUCE_LOG");
    for (var y = 6; y <= 9; y++) put(x - 7, y, z, "IRON_CHAIN");
    put(x - 7, 5, z, "IRON_BLOCK");
  }

  private void fountain(int x, int z) {
    for (var dx = -2; dx <= 2; dx++)
      for (var dz = -2; dz <= 2; dz++)
        put(
            x + dx,
            1,
            z + dz,
            Math.abs(dx) == 2 || Math.abs(dz) == 2 ? "STONE_BRICK_SLAB" : "WATER");
    column(x, z, new Vertical(1, 3, "POLISHED_ANDESITE"));
    put(x, 4, z, "LANTERN");
  }

  private void stall(int x, int z, String wool) {
    for (var dx = 0; dx <= 5; dx++) {
      put(x + dx, 1, z, "BARREL");
      for (var dz = 0; dz <= 3; dz++) put(x + dx, 4, z + dz, dx % 2 == 0 ? wool : "WHITE_WOOL");
    }
    for (var dx : new int[] {0, 5}) column(x + dx, z, new Vertical(2, 3, "OAK_FENCE"));
  }

  private void crate(int x, int z) {
    put(x, 1, z, "BARREL");
    put(x + 1, 1, z, "OAK_PLANKS");
    put(x, 2, z, "OAK_PLANKS");
  }

  private void bench(int x, int z) {
    for (var dx = 0; dx < 3; dx++) {
      put(
          x + dx,
          1,
          z,
          "minecraft:spruce_stairs[facing=north,half=bottom,shape=straight,waterlogged=false]");
      put(x + dx, 1, z - 1, "OAK_SIGN");
    }
  }

  private void lamp(int x, int z) {
    column(x, z, new Vertical(1, 4, "OAK_FENCE"));
    put(x, 5, z, "LANTERN");
  }

  private void tree(int x, int z) {
    column(x, z, new Vertical(1, 6, "OAK_LOG"));
    for (var dx = -2; dx <= 2; dx++)
      for (var dz = -2; dz <= 2; dz++)
        for (var y = 5; y <= 7; y++)
          if (Math.abs(dx) + Math.abs(dz) < 4)
            put(
                x + dx,
                y,
                z + dz,
                "minecraft:oak_leaves[distance=1,persistent=true,waterlogged=false]");
  }

  private record Vertical(int low, int high, String material) {}

  private void column(int x, int z, Vertical vertical) {
    for (var y = vertical.low(); y <= vertical.high(); y++) put(x, y, z, vertical.material());
  }

  private void clear(int x, int y, int z, int height) {
    for (var dy = 0; dy < height; dy++) put(x, y + dy, z, "AIR");
  }

  private void put(int x, int y, int z, String material) {
    absolute(X + x, FLOOR + y, Z + z, material);
  }

  private void absolute(int x, int y, int z, String material) {
    var pos = new BlockPos(x, y, z);
    var exit = content.arena().exit().point().block();
    if (!content.arena().region().contains(pos)
        && !(x == exit.x() && z == exit.z() && Math.abs(y - exit.y()) <= 1))
      throw new IllegalArgumentException("Blueprint exceeds protected footprint: " + pos);
    blocks.put(pos, material);
  }
}
