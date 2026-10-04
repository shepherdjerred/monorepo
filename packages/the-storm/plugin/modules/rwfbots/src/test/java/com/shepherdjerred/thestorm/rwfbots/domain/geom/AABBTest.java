package com.shepherdjerred.thestorm.rwfbots.domain.geom;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import org.junit.jupiter.api.Test;

final class AABBTest {

  @Test
  void rayHitsAPlayerBoxInFront() {
    var box = AABB.playerAt(new Vec3(0, 0, 3), false);
    var entry = box.rayEntry(new Vec3(0, 1.62, 0), new Vec3(0, 0, 1));
    assertThat(entry).isPresent();
    assertThat(entry.getAsDouble()).isCloseTo(2.7, within(1e-9));
  }

  @Test
  void rayMissesABoxToTheSideOrBehind() {
    var box = AABB.playerAt(new Vec3(0, 0, 3), false);
    assertThat(box.rayEntry(new Vec3(2, 1.62, 0), new Vec3(0, 0, 1))).isEmpty();
    assertThat(box.rayEntry(new Vec3(0, 1.62, 0), new Vec3(0, 0, -1))).isEmpty();
  }

  @Test
  void originInsideGivesZero() {
    var box = AABB.ofCell(new BlockPos(0, 0, 0));
    assertThat(box.rayEntry(new Vec3(0.5, 0.5, 0.5), new Vec3(1, 0, 0)).getAsDouble()).isZero();
  }
}
