package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import org.junit.jupiter.api.Test;

final class VoxelGridTest {

  private final VoxelGrid grid = VoxelGrid.from(SyntheticMap.open());

  @Test
  void wallBlocksSightAndMovement() {
    var west = new Vec3(10.5, 2.6, 5.5);
    var east = new Vec3(22.5, 2.6, 5.5);
    assertThat(grid.canSee(west, east)).isFalse();
    assertThat(grid.raycast(west, east, VoxelGrid.Layer.SIGHT))
        .contains(new BlockPos(SyntheticMap.WALL_X, 2, 5));
    assertThat(grid.raycast(west, east, VoxelGrid.Layer.MOVEMENT)).isPresent();
  }

  @Test
  void glassBlocksMovementAndArrowsButNotSight() {
    var west = new Vec3(10.5, 2.6, 20.5);
    var east = new Vec3(22.5, 2.6, 20.5);
    assertThat(grid.canSee(west, east)).isTrue();
    assertThat(grid.raycast(west, east, VoxelGrid.Layer.MOVEMENT))
        .contains(new BlockPos(SyntheticMap.WALL_X, 2, 20));
    assertThat(grid.raycast(west, east, VoxelGrid.Layer.PROJECTILE)).isPresent();
  }

  @Test
  void doorLetsSightThrough() {
    assertThat(grid.canSee(new Vec3(10.5, 2.6, 15.5), new Vec3(22.5, 2.6, 15.5))).isTrue();
  }

  @Test
  void diagonalRayAboveTheWallIsClear() {
    assertThat(grid.canSee(new Vec3(1.5, 5.5, 1.5), new Vec3(30.5, 6.5, 30.5))).isTrue();
  }

  @Test
  void raycastCostsMicroseconds() {
    var from = new Vec3(1.5, 2.6, 1.5);
    var to = new Vec3(30.5, 2.6, 30.5);
    for (var i = 0; i < 20_000; i++) {
      grid.canSee(from, to);
    }
    var start = System.nanoTime();
    var clear = 0;
    for (var i = 0; i < 100_000; i++) {
      if (grid.canSee(from, to.plus(0, 0, i % 7 * 0.01))) {
        clear++;
      }
    }
    var perRayMicros = (System.nanoTime() - start) / 100_000.0 / 1000.0;
    assertThat(clear).isZero();
    assertThat(perRayMicros).as("microseconds per 40-block ray").isLessThan(20);
  }
}
