package com.shepherdjerred.thestorm.skylands.domain;

import java.util.Optional;

/** Finds real, clear island ground near the origin without creating a starter platform. */
public final class LayeredSpawn {
  private LayeredSpawn() {}

  public static SkyPosition find(LayeredLandscape landscape) {
    var terrain = new TerrainWindow(landscape);
    for (var radius = 0; radius <= 16; radius++) {
      var found = ring(terrain, radius);
      if (found.isPresent()) return found.orElseThrow();
    }
    throw new IllegalStateException("No safe layered spawn for seed " + landscape.seed());
  }

  private static Optional<SkyPosition> ring(TerrainWindow terrain, int radius) {
    for (var x = -radius; x <= radius; x++) {
      for (var z = -radius; z <= radius; z++) {
        if (Math.max(Math.abs(x), Math.abs(z)) != radius) continue;
        var wx = x * 16 + 8;
        var wz = z * 16 + 8;
        for (var y : terrain.column(wx, wz).surfaces(40, 230).reversed()) {
          var p = new SkyPosition(wx, y + 1, wz);
          if (safe(terrain, p)) return Optional.of(p);
        }
      }
    }
    return Optional.empty();
  }

  private static boolean safe(TerrainWindow terrain, SkyPosition p) {
    for (var dx = -2; dx <= 2; dx++) {
      for (var dz = -2; dz <= 2; dz++) {
        var q = p.add(new SkyPosition(dx, 0, dz));
        if (!terrain.solid(q.above(-1)) || !terrain.air(q) || !terrain.air(q.above(1)))
          return false;
      }
    }
    return true;
  }
}
