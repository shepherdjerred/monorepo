/*
 * Ported from Spottedleaf's OldGenerator (https://github.com/Spottedleaf/OldGenerator), file
 * src/main/java/ca/spottedleaf/oldgenerator/generator/b173/noise/NoiseGeneratorPerlin173.java
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
 * One octave of Beta 1.7.3 improved Perlin noise. Only the bulk three-dimensional sampler that the
 * Skylands density uses is ported.
 *
 * <p>Immutable after construction, so one instance serves every world generation thread. The bulk
 * sampler deliberately keeps Beta's cache of the four y-lattice corner gradients: it is reused for
 * every sample in the same y cell even though the gradients were evaluated at the first sample's y
 * fraction. Recomputing them would be "more correct" and would change the terrain.
 */
final class PerlinNoise {

  private final int[] permutations = new int[512];
  private final double xOffset;
  private final double yOffset;
  private final double zOffset;

  PerlinNoise(Lcg48 random) {
    xOffset = random.nextDouble() * 256.0;
    yOffset = random.nextDouble() * 256.0;
    zOffset = random.nextDouble() * 256.0;
    for (var i = 0; i < 256; i++) {
      permutations[i] = i;
    }
    for (var i = 0; i < 256; i++) {
      var swap = random.nextInt(256 - i) + i;
      var held = permutations[i];
      permutations[i] = permutations[swap];
      permutations[swap] = held;
      permutations[i + 256] = permutations[i];
    }
  }

  /**
   * Adds this octave, sampled over {@code grid} at {@code frequency} and weighted by {@code
   * 1/frequency}, into {@code out}, ordered x, then z, then y.
   */
  void add(double[] out, NoiseGrid grid, double frequency) {
    var scaleX = grid.scaleX() * frequency;
    var scaleY = grid.scaleY() * frequency;
    var scaleZ = grid.scaleZ() * frequency;
    var amplitude = 1.0 / frequency;
    var index = 0;
    var cachedY = -1;
    var y0z0 = 0.0;
    var y1z0 = 0.0;
    var y0z1 = 0.0;
    var y1z1 = 0.0;
    for (var ix = 0; ix < grid.sizeX(); ix++) {
      var x = (grid.x() + ix) * scaleX + xOffset;
      var latticeX = floor(x);
      var px = latticeX & 255;
      x -= latticeX;
      var fadeX = fade(x);
      for (var iz = 0; iz < grid.sizeZ(); iz++) {
        var z = (grid.z() + iz) * scaleZ + zOffset;
        var latticeZ = floor(z);
        var pz = latticeZ & 255;
        z -= latticeZ;
        var fadeZ = fade(z);
        for (var iy = 0; iy < grid.sizeY(); iy++) {
          var y = (grid.y() + iy) * scaleY + yOffset;
          var latticeY = floor(y);
          var py = latticeY & 255;
          y -= latticeY;
          var fadeY = fade(y);
          if (iy == 0 || py != cachedY) {
            cachedY = py;
            var a = permutations[px] + py;
            var aa = permutations[a] + pz;
            var ab = permutations[a + 1] + pz;
            var b = permutations[px + 1] + py;
            var ba = permutations[b] + pz;
            var bb = permutations[b + 1] + pz;
            y0z0 =
                lerp(fadeX, grad(permutations[aa], x, y, z), grad(permutations[ba], x - 1.0, y, z));
            y1z0 =
                lerp(
                    fadeX,
                    grad(permutations[ab], x, y - 1.0, z),
                    grad(permutations[bb], x - 1.0, y - 1.0, z));
            y0z1 =
                lerp(
                    fadeX,
                    grad(permutations[aa + 1], x, y, z - 1.0),
                    grad(permutations[ba + 1], x - 1.0, y, z - 1.0));
            y1z1 =
                lerp(
                    fadeX,
                    grad(permutations[ab + 1], x, y - 1.0, z - 1.0),
                    grad(permutations[bb + 1], x - 1.0, y - 1.0, z - 1.0));
          }
          var near = lerp(fadeY, y0z0, y1z0);
          var far = lerp(fadeY, y0z1, y1z1);
          out[index++] += lerp(fadeZ, near, far) * amplitude;
        }
      }
    }
  }

  private static int floor(double value) {
    var truncated = (int) value;
    return value < truncated ? truncated - 1 : truncated;
  }

  private static double fade(double t) {
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
  }

  private static double lerp(double t, double from, double to) {
    return from + t * (to - from);
  }

  private static double grad(int hash, double x, double y, double z) {
    var h = hash & 15;
    var u = h < 8 ? x : y;
    var v = h < 4 ? y : (h != 12 && h != 14 ? z : x);
    return ((h & 1) == 0 ? u : -u) + ((h & 2) == 0 ? v : -v);
  }
}
