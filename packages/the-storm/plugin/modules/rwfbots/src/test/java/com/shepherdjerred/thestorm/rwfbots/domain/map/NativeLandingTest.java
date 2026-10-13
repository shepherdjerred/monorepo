package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import java.util.List;
import org.junit.jupiter.api.Test;

final class NativeLandingTest {
  private record Course(int width, boolean raised, boolean diagonal)
      implements BlockClassification {
    @Override
    public GridBounds bounds() {
      return new GridBounds(new BlockPos(0, 0, 0), 17, 8, 17);
    }

    @Override
    public BlockShape shape(int x, int y, int z) {
      if (y == 0) {
        if ((x >= 3 && x < 3 + width) || (diagonal && z >= 3 && z < 3 + width))
          return BlockShape.PASSABLE;
        return BlockShape.FULL;
      }
      return raised && y == 1 && x >= 3 + width ? BlockShape.FULL : BlockShape.PASSABLE;
    }

    @Override
    public boolean blocksSight(int x, int y, int z) {
      return shape(x, y, z).blocksMovement();
    }
  }

  @Test
  void nativeCertifiedPartialFootprintCatchesRetainFlatRaisedAndDiagonalGapRoutes() {
    for (var course :
        List.of(
            new Course(3, false, false), new Course(2, true, false), new Course(2, false, true))) {
      var graph = NavGraphBuilder.build(course);
      var source = graph.nodeAt(new BlockPos(2, 1, 2)).orElseThrow();
      var goal =
          graph
              .nodeAt(
                  new BlockPos(
                      course.diagonal() ? 5 : 3 + course.width(),
                      course.raised() ? 2 : 1,
                      course.diagonal() ? 5 : 2))
              .orElseThrow();
      var edges =
          java.util.stream.IntStream.range(graph.edgeStart(source), graph.edgeEnd(source))
              .filter(edge -> graph.edgeTarget(edge) == goal && graph.edgeHop(edge) == Hop.LEAP)
              .toArray();
      assertThat(edges).as(course.toString()).isNotEmpty();
    }
  }
}
