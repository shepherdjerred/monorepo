package com.shepherdjerred.thestorm.world.domain;

/**
 * The edge of a circular world border, in block columns.
 *
 * @param world the world name
 * @param centerX disc center x
 * @param centerZ disc center z
 * @param radius disc radius in blocks
 */
public record CircleEdge(String world, double centerX, double centerZ, double radius) {

  public CircleEdge {
    if (!Double.isFinite(radius) || radius <= 0) {
      throw new IllegalArgumentException("circle radius must be positive: " + radius);
    }
  }

  /** Whether the column at ({@code x}, {@code z}) is inside the disc. */
  public boolean contains(double x, double z) {
    var dx = x - centerX;
    var dz = z - centerZ;
    return dx * dx + dz * dz <= radius * radius;
  }

  /**
   * The column {@code margin} blocks inside the edge on the line from the center through ({@code
   * x}, {@code z}); the center itself when that point is the center.
   */
  public Column inward(double x, double z, double margin) {
    if (margin < 0 || margin >= radius) {
      throw new IllegalArgumentException("margin must be inside the radius: " + margin);
    }
    var dx = x - centerX;
    var dz = z - centerZ;
    var distance = Math.hypot(dx, dz);
    if (distance == 0) {
      return new Column(centerX, centerZ);
    }
    var scale = (radius - margin) / distance;
    return new Column(centerX + dx * scale, centerZ + dz * scale);
  }

  /**
   * A horizontal position.
   *
   * @param x block x
   * @param z block z
   */
  public record Column(double x, double z) {}
}
