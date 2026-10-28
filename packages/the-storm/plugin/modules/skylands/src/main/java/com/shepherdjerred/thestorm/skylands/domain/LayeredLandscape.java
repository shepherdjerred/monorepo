package com.shepherdjerred.thestorm.skylands.domain;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import org.jspecify.annotations.Nullable;

/** Immutable world definition with a bounded, synchronized density memo. */
public final class LayeredLandscape {
  public static final int MIN_Y = LayeredNoise.MIN_Y;
  public static final int MAX_Y = MIN_Y + LayeredNoise.HEIGHT;
  private final long seed;
  private final LayeredNoise noise;
  private final SkyOcean ocean;
  private final LinkedHashMap<Long, LayeredChunk> chunks = new LinkedHashMap<>();

  public LayeredLandscape(long seed) {
    this.seed = seed;
    noise = new LayeredNoise(seed);
    ocean = new SkyOcean(seed);
  }

  public long seed() {
    return seed;
  }

  public Column column(int x, int z) {
    return new Column(
        chunk(Math.floorDiv(x, 16), Math.floorDiv(z, 16)),
        Math.floorMod(x, 16),
        Math.floorMod(z, 16),
        ocean.column(x, z));
  }

  private LayeredChunk chunk(int x, int z) {
    var key = columnKey(x, z);
    synchronized (chunks) {
      var found = chunks.get(key);
      if (found != null) return found;
    }
    var result = noise.chunk(x, z);
    synchronized (chunks) {
      var found = chunks.get(key);
      if (found != null) return found;
      chunks.put(key, result);
      if (chunks.size() > 256) chunks.pollFirstEntry();
      return result;
    }
  }

  static long columnKey(int x, int z) {
    return ((long) x << 32) ^ (z & 0xffffffffL);
  }

  public record Column(LayeredChunk noise, int x, int z, SkyOcean.@Nullable Column ocean) {
    public boolean original(int y) {
      return noise.solid(x, y, z);
    }

    public boolean solid(int y) {
      return original(y) || (ocean != null && y >= ocean.bottom() && y <= ocean.ground());
    }

    public boolean water(int y) {
      return ocean != null && ocean.wet() && y > ocean.ground() && y <= 63 && !original(y);
    }

    public List<Integer> surfaces(int minimum, int maximum) {
      var result = new ArrayList<Integer>();
      for (var y = Math.max(MIN_Y, minimum); y <= Math.min(MAX_Y - 2, maximum); y++) {
        if (solid(y) && !solid(y + 1) && !water(y + 1)) result.add(y);
      }
      return List.copyOf(result);
    }
  }
}
