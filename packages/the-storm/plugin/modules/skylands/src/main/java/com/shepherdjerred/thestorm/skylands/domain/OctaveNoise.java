/*
 * Ported from Spottedleaf's OldGenerator (https://github.com/Spottedleaf/OldGenerator), file
 * src/main/java/ca/spottedleaf/oldgenerator/generator/b173/noise/NoiseGeneratorOctaves173.java
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
 * Beta 1.7.3 fractal noise: octave {@code i} samples at frequency {@code 2^-i} with amplitude
 * {@code 2^i}. Immutable after construction; every call returns a fresh array.
 */
final class OctaveNoise {

  private final PerlinNoise[] octaves;

  OctaveNoise(Lcg48 random, int count) {
    octaves = new PerlinNoise[count];
    for (var i = 0; i < count; i++) {
      octaves[i] = new PerlinNoise(random);
    }
  }

  /** Samples every octave over {@code grid}, ordered x, then z, then y. */
  double[] sample(NoiseGrid grid) {
    var out = new double[grid.samples()];
    var frequency = 1.0;
    for (var octave : octaves) {
      octave.add(out, grid, frequency);
      frequency /= 2.0;
    }
    return out;
  }
}
