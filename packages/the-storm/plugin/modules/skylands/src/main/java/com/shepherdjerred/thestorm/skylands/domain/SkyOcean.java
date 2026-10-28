package com.shepherdjerred.thestorm.skylands.domain;

import org.jspecify.annotations.Nullable;

/** Rare, closed sea vessels added to the density field; original shelves are never removed. */
public final class SkyOcean {
  public record Column(
      int ground, int bottom, boolean wet, int climate, int centerX, int centerZ) {}

  private final long seed;

  public SkyOcean(long seed) {
    this.seed = seed;
  }

  public @Nullable Column column(int x, int z) {
    var rx = Math.floorDiv(x, 512);
    var rz = Math.floorDiv(z, 512);
    for (var a = rx - 1; a <= rx + 1; a++) {
      for (var b = rz - 1; b <= rz + 1; b++) {
        var result = candidate(new SkyPosition(a, 0, b), x, z);
        if (result != null) return result;
      }
    }
    return null;
  }

  private @Nullable Column candidate(SkyPosition cell, int x, int z) {
    int a = cell.x(), b = cell.z();
    if (Math.floorMod(a, 4) != 0 || Math.floorMod(b, 4) != 0) return null;
    var random = new Lcg48(a * 341873128712L + b * 132897987541L + seed + 10387313L);
    var cx = (a * 32 + (random.nextInt(27) + random.nextInt(27)) / 2) * 16 + 8;
    var cz = (b * 32 + (random.nextInt(27) + random.nextInt(27)) / 2) * 16 + 8;
    if (Math.abs(x - cx) > 210 || Math.abs(z - cz) > 200) return null;
    var dx = x - cx + 30 * SkyRandom.noise(x / 110.0, 0, z / 110.0, seed + 33);
    var dz = z - cz + 24 * SkyRandom.noise(x / 130.0, 0, z / 130.0, seed + 34);
    var edge =
        1
            - Math.pow(Math.pow(dx / 145, 4) + Math.pow(dz / 135, 4), .25)
            + .16 * SkyRandom.noise(x / 63.0, 0, z / 63.0, seed + 35)
            + .045 * SkyRandom.noise(x / 21.0, 0, z / 21.0, seed + 36);
    return vessel(new SkyPosition(cx, Math.floorMod(a / 4 + b / 4, 3), cz), x, z, edge);
  }

  private @Nullable Column vessel(SkyPosition center, int x, int z, double edge) {
    if (edge < -.12) return null;
    var wet = edge > .025;
    var ground =
        wet
            ? Math.max(
                18,
                63
                    - (int) (Math.min(1, edge / .34) * 40)
                    + (int) (SkyRandom.noise(x / 42.0, 0, z / 42.0, seed + 37) * 2))
            : 63 + (int) (Math.max(0, -edge) * 90);
    var bottom = ground - 18 - (int) (4 * SkyRandom.noise(x / 35.0, 0, z / 35.0, seed + 38));
    return new Column(ground, bottom, wet, center.y(), center.x(), center.z());
  }
}
