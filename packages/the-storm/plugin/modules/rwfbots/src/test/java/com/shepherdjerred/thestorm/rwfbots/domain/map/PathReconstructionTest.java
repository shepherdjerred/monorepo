package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import java.util.List;
import org.junit.jupiter.api.Test;

final class PathReconstructionTest {

  @Test
  void mixedHopsKeepTheirArrivalPositionsAndBackwardCostSummation() {
    var bounds = new GridBounds(new BlockPos(0, 0, 0), 5, 1, 1);
    var costs = new float[] {1, 0x1.0p60f, 128, 128};
    var graph =
        new NavGraph(
            bounds,
            new int[] {0, 1, 2, 3, 4},
            new NavGraph.Topology(new int[] {0, 1, 2, 3, 4, 4}, new int[] {1, 2, 3, 4}),
            new NavGraph.EdgeData(
                new byte[] {Hop.JUMP.code(), Hop.CLIMB.code(), Hop.LEAP.code(), Hop.DROP.code()},
                costs));
    var path = graph.path(0, 4).orElseThrow();
    assertThat(path.nodes()).containsExactly(0, 1, 2, 3, 4);
    assertThat(path.waypoints().stream().map(waypoint -> waypoint.hop()))
        .containsExactly(Hop.WALK, Hop.JUMP, Hop.CLIMB, Hop.LEAP, Hop.DROP);
    assertThat(path.waypoints().stream().map(waypoint -> waypoint.pos()))
        .containsExactlyElementsOf(List.of(0, 1, 2, 3, 4).stream().map(graph::feet).toList());
    double expected = costs[3];
    expected += costs[2];
    expected += costs[1];
    expected += costs[0];
    double forward = 0;
    for (var cost : costs) {
      forward += cost;
    }
    assertThat(Double.doubleToLongBits(expected)).isNotEqualTo(Double.doubleToLongBits(forward));
    assertThat(Double.doubleToLongBits(path.cost())).isEqualTo(Double.doubleToLongBits(expected));
    assertThat(path.toFollow()).containsExactlyElementsOf(path.waypoints().subList(1, 5));
  }

  @Test
  void pathsRemainImmutableAndIndependentOfReusedSearchScratch() {
    var graph = SyntheticMap.bake().graph();
    var workspace = graph.workspace();
    var from = graph.nodeAt(SyntheticMap.RED_SPAWN).orElseThrow();
    var to = graph.nodeAt(new BlockPos(29, 1, 2)).orElseThrow();
    var original = graph.path(from, to, ignored -> 0, workspace).orElseThrow();
    var expected = new NavPath(original.nodes(), original.waypoints(), original.cost());
    var reversed = graph.path(to, from, ignored -> 0, workspace).orElseThrow();
    assertThat(reversed.nodes().getFirst()).isEqualTo(to);
    assertThat(reversed.nodes().getLast()).isEqualTo(from);
    assertThat(original).isEqualTo(expected);
    assertThatThrownBy(() -> original.nodes().set(0, to))
        .isInstanceOf(UnsupportedOperationException.class);
    assertThatThrownBy(() -> original.waypoints().clear())
        .isInstanceOf(UnsupportedOperationException.class);
    assertThatThrownBy(() -> original.toFollow().clear())
        .isInstanceOf(UnsupportedOperationException.class);
    var stationary = graph.path(from, from, ignored -> 0, workspace).orElseThrow();
    assertThat(stationary.nodes()).containsExactly(from);
    assertThat(stationary.waypoints())
        .singleElement()
        .satisfies(
            point -> {
              assertThat(point.pos()).isEqualTo(graph.feet(from));
              assertThat(point.hop()).isEqualTo(Hop.WALK);
            });
    assertThat(stationary.cost()).isZero();
    assertThat(stationary.toFollow()).isEmpty();
  }
}
