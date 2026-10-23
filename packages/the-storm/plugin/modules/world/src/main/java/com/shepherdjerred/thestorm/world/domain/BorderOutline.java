package com.shepherdjerred.thestorm.world.domain;

import java.util.ArrayList;
import java.util.List;

/**
 * The polygon a map draws for a world border: the native square's four corners, or a circle's
 * vertices. Circle vertices lie on the edge, so the polygon's chords are at most two blocks inside
 * it at the radii the server uses.
 *
 * @param world the world name
 * @param points the vertices in order; the polygon closes from the last back to the first
 */
public record BorderOutline(String world, List<Point> points) {

  /** Enough vertices that a 12000-block radius stays within 2 blocks of its edge. */
  public static final int CIRCLE_VERTICES = 192;

  /**
   * One vertex, in block coordinates.
   *
   * @param x block x
   * @param z block z
   */
  public record Point(double x, double z) {}

  public BorderOutline {
    points = List.copyOf(points);
    if (points.size() < 3) {
      throw new IllegalArgumentException("a border outline needs at least three points");
    }
  }

  /** The outline of {@code border}, drawn exactly where it stops players. */
  public static BorderOutline of(WorldBorderSpec border) {
    var half = border.size() / 2;
    var x = border.centerX();
    var z = border.centerZ();
    if ("circle".equals(border.shape())) {
      var points = new ArrayList<Point>(CIRCLE_VERTICES);
      for (var i = 0; i < CIRCLE_VERTICES; i++) {
        var angle = 2 * Math.PI * i / CIRCLE_VERTICES;
        points.add(new Point(x + half * Math.cos(angle), z + half * Math.sin(angle)));
      }
      return new BorderOutline(border.world(), points);
    }
    return new BorderOutline(
        border.world(),
        List.of(
            new Point(x - half, z - half),
            new Point(x + half, z - half),
            new Point(x + half, z + half),
            new Point(x - half, z + half)));
  }
}
