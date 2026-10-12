package com.shepherdjerred.thestorm.rwf.app.view;

/**
 * A point or direction in world space, for consumers outside the module.
 *
 * @param x east
 * @param y up
 * @param z south
 */
public record Point(double x, double y, double z) {

  public Point {
    if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(z)) {
      throw new IllegalArgumentException("coordinates must be finite: " + x + "," + y + "," + z);
    }
  }
}
