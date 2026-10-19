package com.shepherdjerred.thestorm.skylands.domain;

import java.util.ArrayList;
import java.util.List;

/**
 * Places the ores whose vanilla height bands lie below the islands (diamond, redstone, lapis, gold)
 * into island stone, by Beta terrain y so island cores play the role of the deep underground. A
 * pure function of the world seed and chunk: every vein stays inside its chunk and draws from a
 * counter-based generator, so parallel generation threads agree.
 *
 * <p>Veins never replace the top {@value #SURFACE_DEPTH} blocks of a column, which vanilla's
 * surface rules turn into soil, so ores do not show on island tops.
 */
public final class SkyOres {

  static final int SURFACE_DEPTH = 4;

  private final long seed;
  private final List<OreVein> veins;

  public SkyOres(long seed, List<OreVein> veins) {
    this.seed = seed;
    this.veins = List.copyOf(veins);
  }

  /** The ore blocks for chunk {@code (chunkX, chunkZ)} given its stone. */
  public List<OrePlacement> plan(int chunkX, int chunkZ, IslandChunk chunk) {
    var placements = new ArrayList<OrePlacement>();
    var ground = new DeepStone(chunk);
    for (var index = 0; index < veins.size(); index++) {
      var vein = veins.get(index);
      var walk = new Walk(ground, new SplitMix64(mix(seed, chunkX, chunkZ, index)), placements);
      for (var attempt = 0; attempt < vein.attempts(); attempt++) {
        walk.vein(vein, index);
      }
    }
    return placements;
  }

  /** Grows veins of one kind in one chunk. */
  private record Walk(DeepStone ground, SplitMix64 random, List<OrePlacement> placements) {

    /**
     * Picks a start; if it is deep stone, random-walks {@code vein.size()} steps from it, placing
     * into deep stone it passes through and stopping at the chunk edge.
     */
    void vein(OreVein vein, int index) {
      var x = random.nextInt(16);
      var z = random.nextInt(16);
      var y = vein.minY() + random.nextInt(vein.maxY() - vein.minY() + 1);
      if (!ground.contains(x, y, z)) {
        return;
      }
      for (var step = 0; step < vein.size(); step++) {
        if (ground.contains(x, y, z)) {
          placements.add(new OrePlacement(x, y, z, index));
        }
        var direction = random.nextInt(2) == 0 ? -1 : 1;
        switch (random.nextInt(3)) {
          case 0 -> x += direction;
          case 1 -> y += direction;
          default -> z += direction;
        }
        if (x < 0 || x > 15 || z < 0 || z > 15) {
          return;
        }
      }
    }
  }

  /** Island stone at least {@link #SURFACE_DEPTH} blocks below its column's top. */
  private static final class DeepStone {

    private final IslandChunk chunk;
    private final int[] tops = new int[256];

    DeepStone(IslandChunk chunk) {
      this.chunk = chunk;
      for (var x = 0; x < 16; x++) {
        for (var z = 0; z < 16; z++) {
          tops[x * 16 + z] = chunk.top(x, z).orElse(-1);
        }
      }
    }

    boolean contains(int x, int y, int z) {
      return y >= 0
          && y < SkyTerrain.HEIGHT
          && y <= tops[x * 16 + z] - SURFACE_DEPTH
          && chunk.solid(x, y, z);
    }
  }

  private static long mix(long seed, int chunkX, int chunkZ, int vein) {
    var h = seed ^ 0x6A09E667F3BCC909L;
    h = SplitMix64.finish(h + chunkX * 0x9E3779B97F4A7C15L);
    h = SplitMix64.finish(h + chunkZ * 0xC2B2AE3D27D4EB4FL);
    return SplitMix64.finish(h + vein * 0x165667B19E3779F9L);
  }
}
