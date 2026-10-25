package com.shepherdjerred.thestorm.creative.domain;

/**
 * The road between merged plots. Unlink compares it with the template, decorations included, so an
 * untouched road can separate and a built-on road cannot.
 */
public final class PlotRoads {

  private PlotRoads() {}

  /** Whether every block in {@code road} matches {@code expected}. */
  public static boolean matches(
      PlotArea road,
      PlotFootprint.Band band,
      PlotFootprint.States actual,
      PlotFootprint.States expected) {
    if (band.minY() > band.maxY()) {
      throw new IllegalArgumentException("build height is inverted");
    }
    for (int x = road.minX(); x <= road.maxX(); x++) {
      for (int z = road.minZ(); z <= road.maxZ(); z++) {
        for (int y = band.minY(); y <= band.maxY(); y++) {
          if (!actual.at(x, y, z).equals(expected.at(x, y, z))) {
            return false;
          }
        }
      }
    }
    return true;
  }
}
