/*
 * Ported from Spottedleaf's OldGenerator (https://github.com/Spottedleaf/OldGenerator), file
 * src/main/java/ca/spottedleaf/oldgenerator/generator/b173/sky/ChunkProviderSky173.java (generateTerrainNoise and generateBareTerrain)
 * at commit 8c4ad258a380e9461d00d72ec7c9af9006bc050a. See packages/the-storm/NOTICE.
 *
 * The MIT License (MIT)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 * associated documentation files (the "Software"), to deal in the Software without restriction,
 * including without limitation the rights to use, copy, modify, merge, publish, distribute,
 * sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or
 * substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
 * NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 * DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
 * OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
package com.shepherdjerred.thestorm.skylands.domain;

/**
 * The Beta 1.7.3 Skylands terrain shape: where a seed puts stone in a 16x128x16 chunk. Beta's
 * biomes, surface, caves and populators are not ported; modern generation supplies those.
 *
 * <p>Beta sampled a 3x33x3 density lattice per chunk (cells of 8x4x8 blocks) and filled stone
 * wherever the trilinear interpolation is positive. Skylands fixed every column's temperature at
 * 0.5 and rainfall at 0, which zeroes Beta's height-variation terms, so its two height noises never
 * influence the shape and are not constructed. The three density noises are constructed first from
 * the seed, exactly as Beta did, so a seed yields Beta's islands.
 *
 * <p>Immutable after construction: any number of world generation threads may call {@link
 * #chunk(int, int)} at once.
 */
public final class SkyTerrain {

  /** Blocks of terrain height, from Beta's local y 0. */
  public static final int HEIGHT = 128;

  private static final int CELLS = 2;
  private static final int CELL_WIDTH = 8;
  private static final int CELL_HEIGHT = 4;
  private static final int SAMPLES_XZ = CELLS + 1;
  private static final int SAMPLES_Y = HEIGHT / CELL_HEIGHT + 1;
  private static final int TOP_FADE = 32;
  private static final int BOTTOM_FADE = 8;
  private static final double FADE_TARGET = -30.0;

  private final OctaveNoise low;
  private final OctaveNoise high;
  private final OctaveNoise selector;

  public SkyTerrain(long seed) {
    var random = new Lcg48(seed);
    low = new OctaveNoise(random, 16);
    high = new OctaveNoise(random, 16);
    selector = new OctaveNoise(random, 8);
  }

  /** The stone of chunk {@code (chunkX, chunkZ)}. */
  public IslandChunk chunk(int chunkX, int chunkZ) {
    var density = density(chunkX * CELLS, chunkZ * CELLS);
    var solid = new boolean[16 * 16 * HEIGHT];
    for (var cellX = 0; cellX < CELLS; cellX++) {
      for (var cellZ = 0; cellZ < CELLS; cellZ++) {
        for (var cellY = 0; cellY < SAMPLES_Y - 1; cellY++) {
          fillCell(density, solid, cellX * CELLS + cellZ, cellY);
        }
      }
    }
    return new IslandChunk(solid);
  }

  /** Interpolates one 8x4x8 cell, {@code column} being {@code cellX * CELLS + cellZ}. */
  private static void fillCell(double[] density, boolean[] solid, int column, int cellY) {
    var cellX = column / CELLS;
    var cellZ = column % CELLS;
    var stepY = 1.0 / CELL_HEIGHT;
    var x0z0 = density[sample(cellX, cellZ, cellY)];
    var x0z1 = density[sample(cellX, cellZ + 1, cellY)];
    var x1z0 = density[sample(cellX + 1, cellZ, cellY)];
    var x1z1 = density[sample(cellX + 1, cellZ + 1, cellY)];
    var x0z0PerY = (density[sample(cellX, cellZ, cellY + 1)] - x0z0) * stepY;
    var x0z1PerY = (density[sample(cellX, cellZ + 1, cellY + 1)] - x0z1) * stepY;
    var x1z0PerY = (density[sample(cellX + 1, cellZ, cellY + 1)] - x1z0) * stepY;
    var x1z1PerY = (density[sample(cellX + 1, cellZ + 1, cellY + 1)] - x1z1) * stepY;
    for (var dy = 0; dy < CELL_HEIGHT; dy++) {
      var stepX = 1.0 / CELL_WIDTH;
      var zNear = x0z0;
      var zFar = x0z1;
      var zNearPerX = (x1z0 - x0z0) * stepX;
      var zFarPerX = (x1z1 - x0z1) * stepX;
      for (var dx = 0; dx < CELL_WIDTH; dx++) {
        var index =
            ((dx + cellX * CELL_WIDTH) << 11)
                | ((cellZ * CELL_WIDTH) << 7)
                | (cellY * CELL_HEIGHT + dy);
        var stepZ = 1.0 / CELL_WIDTH;
        var value = zNear;
        var valuePerZ = (zFar - zNear) * stepZ;
        for (var dz = 0; dz < CELL_WIDTH; dz++) {
          solid[index] = value > 0.0;
          index += HEIGHT;
          value += valuePerZ;
        }
        zNear += zNearPerX;
        zFar += zFarPerX;
      }
      x0z0 += x0z0PerY;
      x0z1 += x0z1PerY;
      x1z0 += x1z0PerY;
      x1z1 += x1z1PerY;
    }
  }

  private static int sample(int x, int z, int y) {
    return (x * SAMPLES_XZ + z) * SAMPLES_Y + y;
  }

  /** The density lattice whose first sample is cell {@code (cellX, 0, cellZ)}. */
  double[] density(int cellX, int cellZ) {
    var horizontal = 684.412 * 2.0;
    var vertical = 684.412;
    var blend = selector.sample(grid(cellX, cellZ, horizontal / 80.0, vertical / 160.0));
    var lows = low.sample(grid(cellX, cellZ, horizontal, vertical));
    var highs = high.sample(grid(cellX, cellZ, horizontal, vertical));
    var out = new double[blend.length];
    for (var i = 0; i < out.length; i++) {
      out[i] =
          shape(lows[i] / 512.0, highs[i] / 512.0, (blend[i] / 10.0 + 1.0) / 2.0, i % SAMPLES_Y);
    }
    return out;
  }

  private static NoiseGrid grid(int cellX, int cellZ, double horizontal, double vertical) {
    return new NoiseGrid(
        cellX, 0, cellZ, SAMPLES_XZ, SAMPLES_Y, SAMPLES_XZ, horizontal, vertical, horizontal);
  }

  /** Blends the two density noises, then fades the top 32 and bottom 8 samples to open air. */
  private static double shape(double low, double high, double blend, int y) {
    double value;
    if (blend < 0.0) {
      value = low;
    } else if (blend > 1.0) {
      value = high;
    } else {
      value = low + (high - low) * blend;
    }
    value -= 8.0;
    if (y > SAMPLES_Y - TOP_FADE) {
      var fade = (double) ((float) (y - (SAMPLES_Y - TOP_FADE)) / ((float) TOP_FADE - 1.0F));
      value = value * (1.0 - fade) + FADE_TARGET * fade;
    }
    if (y < BOTTOM_FADE) {
      var fade = (double) ((float) (BOTTOM_FADE - y) / ((float) BOTTOM_FADE - 1.0F));
      value = value * (1.0 - fade) + FADE_TARGET * fade;
    }
    return value;
  }
}
