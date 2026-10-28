package com.shepherdjerred.thestorm.skylands.domain;

import java.util.LinkedHashMap;
import java.util.List;

/** All eight Overworld ores use island depth instead of a single global Y band. */
public final class LayeredOres {
  private record Vein(String block, int attempts, int size, int depth) {}

  private static final List<Vein> VEINS =
      List.of(
          new Vein("coal_ore", 12, 12, 4), new Vein("iron_ore", 12, 8, 4),
          new Vein("copper_ore", 8, 12, 4), new Vein("gold_ore", 4, 7, 7),
          new Vein("redstone_ore", 5, 6, 7), new Vein("lapis_ore", 4, 6, 7),
          new Vein("diamond_ore", 3, 5, 10), new Vein("emerald_ore", 2, 3, 7));
  private static final List<SkyPosition> STEPS =
      List.of(
          new SkyPosition(1, 0, 0),
          new SkyPosition(-1, 0, 0),
          new SkyPosition(0, 1, 0),
          new SkyPosition(0, -1, 0),
          new SkyPosition(0, 0, 1),
          new SkyPosition(0, 0, -1));
  private final LayeredLandscape landscape;

  public LayeredOres(LayeredLandscape landscape) {
    this.landscape = landscape;
  }

  public List<SkyPlan.Edit> plan(int chunkX, int chunkZ) {
    var depths = depths(chunkX, chunkZ);
    var result = new LinkedHashMap<SkyPosition, SkyPlan.Edit>();
    for (var kind = 0; kind < VEINS.size(); kind++) {
      var vein = VEINS.get(kind);
      var random =
          new Lcg48(SkyRandom.hash(new SkyPosition(chunkX, kind, chunkZ), landscape.seed() + 701));
      for (var attempt = 0; attempt < vein.attempts() * 3; attempt++) {
        var p = new SkyPosition(random.nextInt(16), -24 + random.nextInt(276), random.nextInt(16));
        for (var step = 0; step < vein.size() && inside(p); step++) {
          if (depths[index(p)] >= vein.depth()) {
            var world = p.add(new SkyPosition(chunkX * 16, 0, chunkZ * 16));
            result.putIfAbsent(world, new SkyPlan.Edit(world, "minecraft:" + vein.block()));
          }
          p = p.add(STEPS.get(random.nextInt(STEPS.size())));
        }
      }
    }
    return List.copyOf(result.values());
  }

  private int[] depths(int chunkX, int chunkZ) {
    var out = new int[16 * 16 * LayeredNoise.HEIGHT];
    for (var x = 0; x < 16; x++) {
      for (var z = 0; z < 16; z++) {
        var column = landscape.column(chunkX * 16 + x, chunkZ * 16 + z);
        var depth = 0;
        for (var y = LayeredLandscape.MAX_Y - 1; y >= LayeredLandscape.MIN_Y; y--) {
          depth = column.solid(y) ? depth + 1 : 0;
          out[index(new SkyPosition(x, y, z))] = depth;
        }
      }
    }
    return out;
  }

  private static boolean inside(SkyPosition p) {
    return p.x() >= 0
        && p.x() < 16
        && p.z() >= 0
        && p.z() < 16
        && p.y() >= LayeredLandscape.MIN_Y
        && p.y() < LayeredLandscape.MAX_Y;
  }

  private static int index(SkyPosition p) {
    return (p.x() * 16 + p.z()) * LayeredNoise.HEIGHT + p.y() - LayeredLandscape.MIN_Y;
  }
}
