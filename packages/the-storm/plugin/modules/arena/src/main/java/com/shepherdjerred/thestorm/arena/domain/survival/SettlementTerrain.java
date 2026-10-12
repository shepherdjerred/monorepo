package com.shepherdjerred.thestorm.arena.domain.survival;

import static com.shepherdjerred.thestorm.arena.domain.survival.SettlementBlocks.at;

import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.arena.domain.geometry.Cuboid;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** Streets rise through the terraces; district volumes also reserve the cathedral undercroft. */
final class SettlementTerrain {
  private final SurvivalContent content;
  private final SettlementBlocks build;
  private final Map<BlockPos, String> districts = new HashMap<>();

  SettlementTerrain(SurvivalContent content, SettlementBlocks build) {
    this.content = content;
    this.build = build;
  }

  static int elevation(int x, int z) {
    for (var ramp : RAMPS) {
      if (ramp.area().contains(new BlockPos(x, ramp.base(), z)))
        return rise(ramp.base(), ramp.bottom() - z);
    }
    if (x >= 1768 && x <= 1775 && z >= 2185 && z <= 2191)
      return 88 + Math.min((x - 1767) / 2, (2195 - z) / 2);
    if (x <= 1775 && z < 2192) return 88;
    return z < 2184 ? 104 : z < 2240 ? 88 : 72;
  }

  private record Ramp(Cuboid area, int base, int bottom) {}

  private static final List<Ramp> RAMPS =
      List.of(
          new Ramp(new Cuboid(at(1748, 72, 2235), at(1755, 72, 2271)), 72, 2271),
          new Ramp(new Cuboid(at(1794, 72, 2235), at(1801, 72, 2267)), 72, 2267),
          new Ramp(new Cuboid(at(1826, 72, 2212), at(1833, 72, 2255)), 72, 2255),
          new Ramp(new Cuboid(at(1776, 88, 2163), at(1783, 88, 2195)), 88, 2195),
          new Ramp(new Cuboid(at(1854, 88, 2159), at(1861, 88, 2191)), 88, 2191));

  private static int rise(int base, int distance) {
    return base + Math.clamp(distance / 2, 0, 16);
  }

  void apply() {
    index();
    var region = content.arena().region();
    for (var x = region.min().x(); x <= region.max().x(); x++)
      for (var z = region.min().z(); z <= region.max().z(); z++) column(x, z, region);
    boundaries();
    retainingButtresses();
    streets();
    railings();
  }

  private void index() {
    for (var zone : content.zones()) for (var area : zone.areas()) indexArea(area, zone.id());
  }

  private void indexArea(Cuboid area, String zone) {
    if (area.max().y() < 88) return;
    for (var x = area.min().x(); x <= area.max().x(); x++)
      for (var z = area.min().z(); z <= area.max().z(); z++)
        if (districts.put(new BlockPos(x, 0, z), zone) != null)
          throw new IllegalArgumentException("Settlement ground districts overlap");
  }

  private void column(int x, int z, Cuboid region) {
    var district = districts.get(new BlockPos(x, 0, z));
    var floor = district == null ? 70 : elevation(x, z);
    for (var y = region.min().y(); y <= region.max().y(); y++) {
      var material = y > floor ? "AIR" : y == floor ? surface(x, z, district) : rock(x, y, z);
      if (district == null && (y == 70 || y == 71)) material = "WATER";
      build.put(x, y, z, material);
    }
  }

  private static String rock(int x, int y, int z) {
    var stratum = Math.floorMod(y + Math.floorDiv(x, 7) + Math.floorDiv(z, 9), 13);
    if (stratum < 2) return "ANDESITE";
    if (stratum == 7) return "MOSSY_COBBLESTONE";
    return "TUFF";
  }

  private static String surface(int x, int z, @Nullable String district) {
    if (district == null) return "SAND";
    var patch = Math.floorMod(Math.floorDiv(x, 3) * 17 + Math.floorDiv(z, 4) * 31, 9);
    return switch (district) {
      case "gardens", "infirmary" -> patch < 6 ? "MOSS_BLOCK" : "COARSE_DIRT";
      case "quarry" -> patch < 3 ? "GRAVEL" : "TUFF";
      case "wharf", "gatehouse" -> patch < 3 ? "DARK_OAK_PLANKS" : "COBBLESTONE";
      default -> patch < 3 ? "MOSSY_STONE_BRICKS" : "STONE_BRICKS";
    };
  }

  private void boundaries() {
    for (var entry : districts.entrySet()) {
      var at = entry.getKey();
      var edge = false;
      var perimeter = false;
      for (var delta : new int[][] {{1, 0}, {-1, 0}, {0, 1}, {0, -1}}) {
        var neighbor = districts.get(new BlockPos(at.x() + delta[0], 0, at.z() + delta[1]));
        perimeter |= neighbor == null;
        edge |= !entry.getValue().equals(neighbor) && !freePair(entry.getValue(), neighbor);
      }
      if (edge) {
        var floor = elevation(at.x(), at.z());
        var wall = Math.floorMod(at.x() + at.z(), 7) < 2 ? "MOSSY_STONE_BRICKS" : "STONE_BRICKS";
        build.box(
            at(at.x(), floor + 1, at.z()), at(at.x(), floor + (perimeter ? 6 : 3), at.z()), wall);
      }
    }
  }

  private static boolean freePair(String one, @Nullable String two) {
    return ("gatehouse".equals(one) || "market".equals(one))
        && ("gatehouse".equals(two) || "market".equals(two));
  }

  private void retainingButtresses() {
    for (var z = 2149; z <= 2279; z += 10)
      for (var side : new int[][] {{1744, -1}, {1863, 1}}) {
        var top = elevation(side[0], z);
        for (var step = 1; step <= 3; step++) {
          var x = side[0] + side[1] * step;
          var cap = Math.max(70, top - step * 4);
          build.box(at(x, 70, z), at(x, cap, z + 2), "MOSSY_STONE_BRICKS");
          build.box(at(x, cap + 1, z), at(x, cap + 1, z + 2), "STONE_BRICKS");
        }
      }
  }

  private void streets() {
    road(at(1755, 0, 2276), at(1784, 0, 2261), 5);
    road(at(1784, 0, 2261), at(1798, 0, 2261), 5);
    road(at(1798, 0, 2267), at(1798, 0, 2235), 7);
    road(at(1752, 0, 2269), at(1752, 0, 2198), 6);
    road(at(1752, 0, 2216), at(1779, 0, 2195), 5);
    road(at(1779, 0, 2195), at(1779, 0, 2163), 6);
    road(at(1780, 0, 2162), at(1795, 0, 2154), 5);
    road(at(1795, 0, 2154), at(1833, 0, 2154), 6);
    road(at(1830, 0, 2254), at(1830, 0, 2214), 6);
    road(at(1830, 0, 2202), at(1857, 0, 2202), 5);
    road(at(1857, 0, 2202), at(1857, 0, 2159), 6);
    road(at(1816, 0, 2270), at(1853, 0, 2267), 5);
    road(at(1759, 0, 2185), at(1759, 0, 2153), 5);
  }

  private void railings() {
    for (var ramp :
        new int[][] {
          {1748, 1755, 2240, 2271},
          {1794, 1801, 2236, 2267},
          {1826, 1833, 2216, 2255},
          {1776, 1783, 2164, 2191},
          {1854, 1861, 2160, 2191}
        }) {
      for (var z = ramp[2]; z <= ramp[3]; z++) {
        var floor = elevation(ramp[0], z);
        for (var x : new int[] {ramp[0] - 1, ramp[1] + 1}) {
          build.box(at(x, 62, z), at(x, floor, z), "STONE_BRICKS");
          build.put(x, floor + 1, z, "STONE_BRICK_WALL");
        }
      }
    }
  }

  private void road(BlockPos from, BlockPos to, int width) {
    var length = Math.max(Math.abs(to.x() - from.x()), Math.abs(to.z() - from.z()));
    for (var step = 0; step <= length; step++) {
      var x = from.x() + (to.x() - from.x()) * step / Math.max(1, length);
      var z = from.z() + (to.z() - from.z()) * step / Math.max(1, length);
      roadPatch(at(x, 0, z), width);
    }
  }

  private void roadPatch(BlockPos point, int width) {
    var x = point.x();
    var z = point.z();
    for (var dx = -width / 2; dx <= width / 2; dx++)
      for (var dz = -width / 2; dz <= width / 2; dz++)
        if (districts.containsKey(new BlockPos(x + dx, 0, z + dz)))
          build.put(
              x + dx,
              elevation(x + dx, z + dz),
              z + dz,
              (x + z + dx + dz) % 11 == 0 ? "ANDESITE" : "STONE_BRICKS");
  }

  void arrivals() {
    staging(content.lobbyArea(), "DARK_OAK_PLANKS");
    staging(content.expedition().area(), "STONE_BRICKS");
    var spectator = content.arena().spectator().point().block();
    build.box(
        at(spectator.x() - 3, spectator.y() - 1, spectator.z() - 2),
        at(spectator.x() + 3, spectator.y() - 1, spectator.z() + 2),
        "DARK_OAK_PLANKS");
    for (var step = 0; step <= 7; step++) {
      build.box(at(1718 + step, 72, 2139), at(1718 + step, 72 + step, 2141), "STONE_BRICKS");
      build.box(at(1718 + step, 73 + step, 2139), at(1718 + step, 83, 2141), "AIR");
    }
  }

  private void staging(Cuboid area, String floor) {
    build.box(
        at(area.min().x(), 62, area.min().z()), at(area.max().x(), 71, area.max().z()), "TUFF");
    build.box(
        at(area.min().x(), 72, area.min().z()), at(area.max().x(), 72, area.max().z()), floor);
    for (var x = area.min().x(); x <= area.max().x(); x++) {
      build.put(x, 73, area.min().z(), "STONE_BRICK_WALL");
      build.put(x, 73, area.max().z(), "STONE_BRICK_WALL");
    }
    build.roof(
        at(area.min().x() + 1, 80, area.min().z() + 1),
        at(area.max().x() - 1, 80, area.min().z() + 8),
        "DARK_OAK_PLANKS");
    for (var x : new int[] {area.min().x() + 2, area.max().x() - 2}) {
      build.box(
          at(x, 73, area.min().z() + 2), at(x, 81, area.min().z() + 2), "STRIPPED_SPRUCE_LOG");
      build.lamp(x, area.max().z() - 3, 72);
    }
  }

  void supports() {
    for (var area : List.of(content.lobbyArea(), content.expedition().area()))
      for (var x : new int[] {area.min().x() + 2, area.max().x() - 2}) {
        build.box(
            at(x, 73, area.min().z() + 2), at(x, 81, area.min().z() + 2), "STRIPPED_SPRUCE_LOG");
        build.lamp(x, area.max().z() - 3, 72);
      }
  }
}
