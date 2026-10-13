package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import java.util.List;
import org.junit.jupiter.api.Test;

final class SlabElevationTest {
  private static final BlockClassification TERRAIN =
      new BlockClassification() {
        @Override
        public GridBounds bounds() {
          return new GridBounds(new BlockPos(0, 0, 0), 14, 7, 3);
        }

        @Override
        public BlockShape shape(int x, int y, int z) {
          if (y == 0) return BlockShape.FULL;
          return y == 1 && x >= 3 && x <= 5 ? BlockShape.SLAB_BOTTOM : BlockShape.PASSABLE;
        }

        @Override
        public boolean blocksSight(int x, int y, int z) {
          return shape(x, y, z).blocksMovement();
        }
      };

  @Test
  void slabFeetAndMeasuredLaunchHeightSurviveTheRequiredCodecMetadata() {
    var nav = MapBaker.bake("slab", TERRAIN, new NavSites(List.of(), List.of()));
    var decoded =
        switch (NavCodec.decode(NavCodec.encode(nav))) {
          case Result.Ok(var value) -> value;
          case Result.Err(var error) -> throw new IllegalStateException(error.message());
        };
    assertThat(decoded.graph()).isEqualTo(nav.graph());
    var graph = decoded.graph();
    var source = graph.nodeAt(new BlockPos(5, 2, 1)).orElseThrow();
    assertThat(graph.feet(source).y()).isEqualTo(1.5);
    var jumps =
        java.util.stream.IntStream.range(graph.edgeStart(source), graph.edgeEnd(source))
            .filter(edge -> graph.edgeHop(edge) == Hop.LEAP)
            .mapToObj(graph::waypoint)
            .toList();
    assertThat(jumps).isNotEmpty();
    assertThat(jumps)
        .allSatisfy(
            point -> {
              assertThat(point.launch().orElseThrow().takeoff().y()).isEqualTo(1.5);
              assertThat(point.launch().orElseThrow().runUpStart().y()).isEqualTo(1.5);
            });
  }
}
