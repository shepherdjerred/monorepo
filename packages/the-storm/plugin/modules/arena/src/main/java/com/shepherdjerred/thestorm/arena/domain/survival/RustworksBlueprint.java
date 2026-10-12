package com.shepherdjerred.thestorm.arena.domain.survival;

import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.arena.domain.geometry.Cuboid;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

/** An abandoned industrial town: offset loading bays, mills, rail yards and gradual hills. */
public final class RustworksBlueprint {
  public static final int BLOCK_BUDGET = 1_400_000;
  private static final int X = 1960;
  private static final int Z = 2144;
  private final SurvivalContent content;
  private final SurvivalPlacement placement;
  private Map<BlockPos, String> placed = Map.of();
  private final Map<BlockPos, String> blocks = new LinkedHashMap<>();
  private final Map<BlockPos, String> districts = new HashMap<>();

  public RustworksBlueprint(SurvivalContent content) {
    if (!content.arena().id().equals("rustworks"))
      throw new IllegalArgumentException("Rustworks needs its authored map content");
    placement = SurvivalPlacement.authored(content);
    this.content = placement.content(content);
  }

  /** One-block rises are distributed across 32-block slopes instead of isolated tall platforms. */
  public static int elevation(int x, int z) {
    return 72 + Math.floorDiv(x - X, 32) + Math.floorDiv(z - Z, 32);
  }

  public Map<BlockPos, String> blocks() {
    if (placed.isEmpty()) {
      build();
      placed = placement.restore(blocks);
    }
    return placed;
  }

  private void build() {
    content.zones().forEach(this::index);
    terrain();
    boundaries();
    new RustworksLandmarks(content, blocks).apply();
    staging(content.lobbyArea(), "BRICKS");
    staging(content.expedition().area(), "POLISHED_DEEPSLATE");
    balcony();
    new SettlementFixtures(content, blocks).apply();
    var exit = content.arena().exit().point().block();
    blocks.put(new BlockPos(exit.x(), exit.y() - 1, exit.z()), "POLISHED_ANDESITE");
    blocks.put(exit, "AIR");
    blocks.put(new BlockPos(exit.x(), exit.y() + 1, exit.z()), "AIR");
    if (blocks.size() > BLOCK_BUDGET)
      throw new IllegalArgumentException("Rustworks exceeds its reviewed block budget");
  }

  private void index(SurvivalContent.Zone zone) {
    for (var area : zone.areas()) {
      for (var x = area.min().x(); x <= area.max().x(); x++) {
        for (var z = area.min().z(); z <= area.max().z(); z++) {
          var prior = districts.put(new BlockPos(x, 0, z), zone.id());
          if (prior != null) throw new IllegalArgumentException("Overlapping Rustworks districts");
        }
      }
    }
  }

  private void terrain() {
    var region = content.arena().region();
    for (var x = region.min().x(); x <= region.max().x(); x++) {
      for (var z = region.min().z(); z <= region.max().z(); z++) {
        terrainColumn(x, z, region);
      }
    }
  }

  private void terrainColumn(int x, int z, Cuboid region) {
    var inside = districts.containsKey(new BlockPos(x, 0, z));
    var floor = inside ? elevation(x, z) : 72;
    for (var y = region.min().y(); y <= region.max().y(); y++)
      put(x, y, z, y > floor ? "AIR" : y == floor ? surface(x, z) : "TUFF");
  }

  private String surface(int x, int z) {
    var district = districts.get(new BlockPos(x, 0, z));
    var patch = Math.floorMod(Math.floorDiv(x, 4) * 17 + Math.floorDiv(z, 3) * 31, 11);
    if (district == null) return patch < 4 ? "MOSS_BLOCK" : "COARSE_DIRT";
    return switch (district) {
      case "railhead", "freight", "coalyard", "crane" -> patch < 3 ? "COARSE_DIRT" : "GRAVEL";
      case "roofgarden", "washhouse", "clinic" -> patch < 5 ? "MOSS_BLOCK" : "STONE_BRICKS";
      case "blastpit", "crypt", "foundry", "boilers" ->
          patch < 3 ? "POLISHED_BASALT" : "POLISHED_BLACKSTONE_BRICKS";
      default -> patch < 3 ? "CRACKED_STONE_BRICKS" : "ANDESITE";
    };
  }

  private void boundaries() {
    for (var entry : districts.entrySet()) {
      var pos = entry.getKey();
      var edge =
          java.util.List.of(
                  new BlockPos(pos.x() - 1, 0, pos.z()),
                  new BlockPos(pos.x() + 1, 0, pos.z()),
                  new BlockPos(pos.x(), 0, pos.z() - 1),
                  new BlockPos(pos.x(), 0, pos.z() + 1))
              .stream()
              .anyMatch(next -> !entry.getValue().equals(districts.get(next)));
      if (edge) boundary(pos, entry.getValue());
    }
  }

  private void boundary(BlockPos pos, String district) {
    var floor = elevation(pos.x(), pos.z());
    var pillar = Math.floorMod(pos.x() + pos.z(), 9) == 0;
    var perimeter =
        java.util.List.of(
                new BlockPos(pos.x() - 1, 0, pos.z()),
                new BlockPos(pos.x() + 1, 0, pos.z()),
                new BlockPos(pos.x(), 0, pos.z() - 1),
                new BlockPos(pos.x(), 0, pos.z() + 1))
            .stream()
            .anyMatch(next -> !districts.containsKey(next));
    var height = perimeter ? 6 : 3;
    var wall =
        switch (district) {
          case "roofgarden", "washhouse", "clinic", "canteen" -> "MOSSY_STONE_BRICKS";
          case "crypt", "control", "blastpit", "barracks" -> "DEEPSLATE_BRICKS";
          default -> "BRICKS";
        };
    for (var rise = 1; rise <= height; rise++) {
      var material = pillar ? "POLISHED_DEEPSLATE" : rise == height ? "IRON_BARS" : wall;
      put(pos.x(), floor + rise, pos.z(), material);
    }
  }

  private void staging(Cuboid area, String wall) {
    for (var x = area.min().x(); x <= area.max().x(); x++) {
      for (var z = area.min().z(); z <= area.max().z(); z++) {
        stagingCell(area, wall, x, z);
      }
    }
    for (var x = area.min().x() + 2; x <= area.max().x() - 2; x++)
      for (var z = area.min().z() + 2; z <= area.min().z() + 6; z++)
        put(x, 78, z, "DARK_OAK_PLANKS");
    for (var x : new int[] {area.min().x() + 2, area.max().x() - 2}) {
      for (var y = 73; y <= 77; y++) put(x, y, area.min().z() + 2, "POLISHED_DEEPSLATE");
      put(x, 76, area.min().z() + 6, "LANTERN");
    }
  }

  private void stagingCell(Cuboid area, String wall, int x, int z) {
    put(x, 72, z, "POLISHED_ANDESITE");
    if (x == area.min().x() || x == area.max().x() || z == area.min().z() || z == area.max().z()) {
      for (var y = 73; y <= 77; y++) put(x, y, z, y == 77 ? "WAXED_CUT_COPPER" : wall);
    }
  }

  private void balcony() {
    var at = content.arena().spectator().point().block();
    for (var x = at.x() - 3; x <= at.x() + 3; x++)
      for (var z = at.z() - 2; z <= at.z() + 2; z++) put(x, at.y() - 1, z, "DARK_OAK_PLANKS");
    for (var step = 0; step <= 6; step++) {
      for (var dx = 0; dx < 3; dx++) {
        var x = at.x() - 9 + step;
        var z = at.z() - 1 + dx;
        put(x, 72 + step, z, "POLISHED_ANDESITE");
        for (var y = 73 + step; y <= 80; y++) put(x, y, z, "AIR");
      }
    }
  }

  private void put(int x, int y, int z, String material) {
    var pos = new BlockPos(x, y, z);
    if (!content.arena().region().contains(pos))
      throw new IllegalArgumentException("Rustworks exceeds protected footprint: " + pos);
    blocks.put(pos, material);
  }
}
