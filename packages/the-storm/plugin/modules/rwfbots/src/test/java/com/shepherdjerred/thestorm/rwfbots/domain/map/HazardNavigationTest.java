package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import org.junit.jupiter.api.Test;

final class HazardNavigationTest {
  private static final BlockPos HAZARD = new BlockPos(2, 1, 1);
  private static final BlockClassification MAP =
      new BlockClassification() {
        @Override
        public GridBounds bounds() {
          return new GridBounds(new BlockPos(0, 0, 0), 5, 3, 3);
        }

        @Override
        public BlockShape shape(int x, int y, int z) {
          if (y == 0) return BlockShape.FULL;
          return new BlockPos(x, y, z).equals(HAZARD) ? BlockShape.HAZARD : BlockShape.PASSABLE;
        }

        @Override
        public boolean blocksSight(int x, int y, int z) {
          return shape(x, y, z) == BlockShape.FULL;
        }
      };

  @Test
  void walksAroundDamagingCellsWithoutInventingAProjectileObstacle() {
    var graph = NavGraphBuilder.build(MAP);
    assertThat(graph.nodeAt(HAZARD)).isEmpty();
    var start = graph.nodeAt(new BlockPos(0, 1, 1)).orElseThrow();
    var end = graph.nodeAt(new BlockPos(4, 1, 1)).orElseThrow();
    var path = graph.path(start, end).orElseThrow();
    assertThat(path.nodes().stream().map(graph::cell)).doesNotContain(HAZARD);
    var grid = VoxelGrid.from(MAP);
    var from = new Vec3(0.5, 1.5, 1.5);
    var to = new Vec3(4.5, 1.5, 1.5);
    assertThat(grid.raycast(from, to, VoxelGrid.Layer.MOVEMENT)).contains(HAZARD);
    assertThat(grid.raycast(from, to, VoxelGrid.Layer.PROJECTILE)).isEmpty();
    assertThat(grid.canSee(from, to)).isTrue();
  }
}
