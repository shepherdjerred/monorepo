package com.shepherdjerred.thestorm.rwf.domain.geometry;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

final class CuboidTest {

  private final Cuboid border = Cuboid.spanning(new BlockPos(10, 0, 10), new BlockPos(-10, 5, -10));

  @Test
  void spanningOrdersTheCorners() {
    assertThat(border).isEqualTo(new Cuboid(new BlockPos(-10, 0, -10), new BlockPos(10, 5, 10)));
    assertThatThrownBy(() -> new Cuboid(new BlockPos(1, 0, 0), new BlockPos(0, 0, 0)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void bothCornersAreInside() {
    assertThat(border.contains(new BlockPos(-10, 0, -10))).isTrue();
    assertThat(border.contains(new BlockPos(10, 5, 10))).isTrue();
    assertThat(border.contains(new BlockPos(11, 5, 10))).isFalse();
    assertThat(border.contains(new Vec3(10.9, 2, 0))).isTrue();
    assertThat(border.contains(new Vec3(-10.1, 2, 0))).isFalse();
  }

  @Test
  void theBorderLimitsColumnsNotHeight() {
    assertThat(border.containsColumn(new Vec3(0, 2, 0))).isTrue();
    assertThat(border.containsColumn(new Vec3(10.9, 400, -10))).isTrue();
    assertThat(border.containsColumn(new Vec3(0, -300, 0))).isTrue();
    assertThat(border.containsColumn(new Vec3(11, 2, 0))).isFalse();
    assertThat(border.containsColumn(new Vec3(0, 2, -10.1))).isFalse();
  }

  @Test
  void theVoidStartsAMarginBelowTheBottomOfTheRegion() {
    assertThat(border.below(new Vec3(0, -8, 0), 8)).isFalse();
    assertThat(border.below(new Vec3(0, -8.01, 0), 8)).isTrue();
    assertThat(border.below(new Vec3(40, 90, 0), 8)).isFalse();
    assertThatThrownBy(() -> border.below(Vec3.ZERO, -1))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void blocksHaveCentresAndFloors() {
    assertThat(new BlockPos(1, 2, 3).center()).isEqualTo(new Vec3(1.5, 2.5, 3.5));
    assertThat(new BlockPos(1, 2, 3).floorCenter()).isEqualTo(new Vec3(1.5, 2, 3.5));
    assertThat(new Vec3(-0.5, 64.9, 2.1).toBlock()).isEqualTo(new BlockPos(-1, 64, 2));
    assertThat(new Vec3(1, 2, 3).distanceTo(new Vec3(1, 2, 7))).isEqualTo(4);
  }

  @Test
  void spawnsFaceSomewhereSensible() {
    assertThatThrownBy(() -> new Spawn(Vec3.ZERO, 360, 0))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Spawn(Vec3.ZERO, 0, 91))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(Spawn.at(new BlockPos(0, 64, 0)).position()).isEqualTo(new Vec3(0.5, 64, 0.5));
  }
}
