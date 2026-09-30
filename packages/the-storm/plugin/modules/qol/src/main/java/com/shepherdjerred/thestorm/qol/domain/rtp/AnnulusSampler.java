package com.shepherdjerred.thestorm.qol.domain.rtp;

import java.util.ArrayList;
import java.util.List;
import java.util.random.RandomGenerator;

/** Uniform samples in a ring, as offsets from spawn. */
public final class AnnulusSampler {

  private final int count;

  public AnnulusSampler(int count) {
    if (count < 1) {
      throw new IllegalArgumentException("count must be positive: " + count);
    }
    this.count = count;
  }

  /** {@code count} points whose distance from the origin lies in {@code ring}. */
  public List<BlockPoint> sample(SearchRing ring, RandomGenerator random) {
    var points = new ArrayList<BlockPoint>(count);
    var inner2 = (double) ring.inner() * ring.inner();
    var outer2 = (double) ring.outer() * ring.outer();
    for (var i = 0; i < count; i++) {
      points.add(one(ring, random, inner2, outer2));
    }
    return List.copyOf(points);
  }

  private static BlockPoint one(
      SearchRing ring, RandomGenerator random, double inner2, double outer2) {
    var angle = random.nextDouble() * Math.PI * 2;
    var radius = Math.sqrt(inner2 + random.nextDouble() * (outer2 - inner2));
    var x = (int) Math.round(Math.cos(angle) * radius);
    var z = (int) Math.round(Math.sin(angle) * radius);
    var point = new BlockPoint(x, z);
    var distance = point.distanceTo(new BlockPoint(0, 0));
    if (distance < ring.inner() || distance > ring.outer()) {
      return along(angle, ring.inner());
    }
    return point;
  }

  private static BlockPoint along(double angle, int radius) {
    return new BlockPoint(
        (int) Math.round(Math.cos(angle) * radius), (int) Math.round(Math.sin(angle) * radius));
  }
}
