package com.shepherdjerred.thestorm.skylands.domain;

/**
 * A rectangular lattice of noise sample points: sample {@code (i, j, k)} is taken at {@code ((x +
 * i) * scaleX, (y + j) * scaleY, (z + k) * scaleZ)} before octave frequency is applied.
 */
record NoiseGrid(
    double x,
    double y,
    double z,
    int sizeX,
    int sizeY,
    int sizeZ,
    double scaleX,
    double scaleY,
    double scaleZ) {

  NoiseGrid {
    if (sizeX < 1 || sizeY < 1 || sizeZ < 1) {
      throw new IllegalArgumentException("noise grid sizes must be positive");
    }
  }

  int samples() {
    return sizeX * sizeY * sizeZ;
  }
}
