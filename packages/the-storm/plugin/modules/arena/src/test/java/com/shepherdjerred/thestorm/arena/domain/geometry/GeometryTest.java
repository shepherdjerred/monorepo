package com.shepherdjerred.thestorm.arena.domain.geometry;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

final class GeometryTest {

  private static final Cuboid BOX = new Cuboid(new BlockPos(-5, 60, -5), new BlockPos(20, 70, 3));

  @Test
  void bothCornersAreInside() {
    assertThat(BOX.contains(new BlockPos(-5, 60, -5))).isTrue();
    assertThat(BOX.contains(new BlockPos(20, 70, 3))).isTrue();
    assertThat(BOX.contains(new BlockPos(21, 70, 3))).isFalse();
    assertThat(BOX.contains(new BlockPos(0, 59, 0))).isFalse();
  }

  @Test
  void pointsBelongToTheBlockTheyAreIn() {
    assertThat(new Point(-0.5, 64, 2.9).block()).isEqualTo(new BlockPos(-1, 64, 2));
    assertThat(BOX.contains(new Point(20.99, 70.5, 3.99))).isTrue();
    assertThat(BOX.contains(new Point(-5.01, 64, 0))).isFalse();
  }

  @Test
  void cornersMustBeInOrder() {
    assertThatThrownBy(() -> new Cuboid(new BlockPos(0, 0, 0), new BlockPos(-1, 5, 5)))
        .hasMessageContaining("must not exceed");
  }

  @Test
  void theBoxListsEveryChunkItTouches() {
    assertThat(BOX.chunks())
        .containsExactlyInAnyOrder(
            new ChunkPos(-1, -1),
            new ChunkPos(-1, 0),
            new ChunkPos(0, -1),
            new ChunkPos(0, 0),
            new ChunkPos(1, -1),
            new ChunkPos(1, 0));
    assertThat(new BlockPos(-17, 0, 16).chunk()).isEqualTo(new ChunkPos(-2, 1));
  }

  @Test
  void spotsAreChecked() {
    assertThat(new Spot(1, 2, 3, 90, -45).point()).isEqualTo(new Point(1, 2, 3));
    assertThatThrownBy(() -> new Spot(0, 0, 0, 181, 0)).hasMessageContaining("yaw");
    assertThatThrownBy(() -> new Spot(0, 0, 0, 0, 91)).hasMessageContaining("pitch");
    assertThatThrownBy(() -> new Spot(Double.NaN, 0, 0, 0, 0)).hasMessageContaining("finite");
    assertThatThrownBy(() -> new Point(0, Double.POSITIVE_INFINITY, 0))
        .hasMessageContaining("finite");
  }

  @Test
  void distancesAndYaml() {
    assertThat(new Point(0, 0, 0).distance(new Point(3, 4, 0))).isEqualTo(5);
    assertThat(new BlockPos(1, 2, 3).center()).isEqualTo(new Point(1.5, 2, 3.5));
    assertThat(new BlockPos(1, 2, 3).describe()).isEqualTo("{x: 1, y: 2, z: 3}");
    assertThat(new Spot(1.5, 64, -2.5, 90, 0).describe())
        .isEqualTo("{x: 1.5, y: 64.0, z: -2.5, yaw: 90.0, pitch: 0.0}");
    assertThat(BOX.floorCenter()).isEqualTo(new Point(8, 60, -0.5));
  }
}
