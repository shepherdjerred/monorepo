package com.shepherdjerred.thestorm.towns.domain.map;

import java.util.List;

/**
 * One connected piece of a town's land as a polygon, in block coordinates.
 *
 * @param ring the outer boundary, corner by corner
 * @param holes unclaimed pockets inside it, each a ring of corners
 */
public record Outline(List<Corner> ring, List<List<Corner>> holes) {

  public Outline {
    ring = List.copyOf(ring);
    holes = holes.stream().map(List::copyOf).toList();
    if (ring.size() < 4) {
      throw new IllegalArgumentException("a ring has at least four corners: " + ring);
    }
  }

  /**
   * A corner of an outline: block ({@code x}, {@code z}), on a chunk edge.
   *
   * @param x block x
   * @param z block z
   */
  public record Corner(int x, int z) {}
}
