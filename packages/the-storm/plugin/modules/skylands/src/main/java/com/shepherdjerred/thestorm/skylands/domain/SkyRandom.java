package com.shepherdjerred.thestorm.skylands.domain;

/** Coordinate hashing for world generation, independent of callbacks and gameplay randomness. */
public final class SkyRandom {
  private SkyRandom() {}

  /** A per-feature deterministic stream; never shared with gameplay or another callback. */
  public static java.util.random.RandomGenerator generator(long seed) {
    return new Sequence(seed);
  }

  private static final class Sequence implements java.util.random.RandomGenerator {
    private long state;

    Sequence(long seed) {
      state = seed;
    }

    @Override
    public long nextLong() {
      state += 0x9E3779B97F4A7C15L;
      return mix(state);
    }
  }

  public static long hash(SkyPosition p, long seed) {
    return mix(
        seed
            ^ p.x() * 0x9E3779B97F4A7C15L
            ^ p.y() * 0xD1B54A32D192ED03L
            ^ p.z() * 0x94D049BB133111EBL);
  }

  public static long mix(long value) {
    var h = (value ^ (value >>> 30)) * 0xbf58476d1ce4e5b9L;
    h = (h ^ (h >>> 27)) * 0x94d049bb133111ebL;
    return h ^ (h >>> 31);
  }

  public static double unit(long value) {
    return (value >>> 11) * 0x1.0p-53;
  }

  private static double smooth(double value) {
    return value * value * (3 - 2 * value);
  }

  private static double lerp(double a, double b, double t) {
    return a + (b - a) * t;
  }

  public static double noise(double x, double y, double z, long seed) {
    int ix = (int) Math.floor(x), iy = (int) Math.floor(y), iz = (int) Math.floor(z);
    double a = smooth(x - ix), b = smooth(y - iy), c = smooth(z - iz);
    var n00 = lerp(corner(ix, iy, iz, seed), corner(ix + 1, iy, iz, seed), a);
    var n01 = lerp(corner(ix, iy, iz + 1, seed), corner(ix + 1, iy, iz + 1, seed), a);
    var n10 = lerp(corner(ix, iy + 1, iz, seed), corner(ix + 1, iy + 1, iz, seed), a);
    var n11 = lerp(corner(ix, iy + 1, iz + 1, seed), corner(ix + 1, iy + 1, iz + 1, seed), a);
    return lerp(lerp(n00, n01, c), lerp(n10, n11, c), b) * 2 - 1;
  }

  private static double corner(int x, int y, int z, long seed) {
    return unit(hash(new SkyPosition(x, y, z), seed));
  }
}
