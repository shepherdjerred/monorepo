package com.shepherdjerred.thestorm.skylands.domain;

/** Sparse feature cells own disjoint horizontal territory, including every bridge and path. */
public record SkyCell(int x, int z) {
  public static final int SIZE = 512;

  public enum Kind {
    VILLAGE,
    MINE,
    ANCIENT_CITY,
    WILDERNESS
  }

  public static SkyCell atChunk(int chunkX, int chunkZ) {
    return new SkyCell(Math.floorDiv(chunkX, SIZE / 16), Math.floorDiv(chunkZ, SIZE / 16));
  }

  public Kind kind(long seed) {
    var value = Math.floorMod(SkyRandom.hash(new SkyPosition(x, 0, z), seed + 1889), 12);
    return switch (value) {
      case 0, 1 -> Kind.VILLAGE;
      case 2, 3, 4 -> Kind.MINE;
      case 5 -> Kind.ANCIENT_CITY;
      default -> Kind.WILDERNESS;
    };
  }

  public long seed(long worldSeed) {
    return SkyRandom.hash(new SkyPosition(x, 0, z), worldSeed + 1907);
  }

  /** A cell's clear perimeter prevents features in adjacent cells from touching. */
  public SkyBounds interior() {
    return new SkyBounds(
        new SkyPosition(x * SIZE + 32, LayeredLandscape.MIN_Y, z * SIZE + 32),
        new SkyPosition((x + 1) * SIZE - 33, LayeredLandscape.MAX_Y - 1, (z + 1) * SIZE - 33));
  }
}
