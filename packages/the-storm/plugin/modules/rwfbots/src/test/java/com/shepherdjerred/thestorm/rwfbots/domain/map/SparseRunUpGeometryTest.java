package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import java.util.ArrayList;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;

final class SparseRunUpGeometryTest {
  private static final LaunchData SHARED =
      new LaunchData(new int[] {0}, new float[] {2}, new float[] {0.27f}, new float[] {0.2f});

  private static NavGraph graph(int origin) {
    var bounds = new GridBounds(new BlockPos(origin, -2, origin), 5, 12, 6);
    return new NavGraph(
        bounds,
        new NavGraph.NodeData(
            new int[] {bounds.index(origin, 8, origin), bounds.index(origin + 3, 1, origin + 4)},
            WaterIndex.empty(bounds),
            new byte[] {-1, 0}),
        new NavGraph.Topology(new int[] {0, 1, 1}, new int[] {1}),
        new NavGraph.EdgeData(
            new byte[] {Hop.LEAP.code()},
            new float[] {20},
            new EdgeCapabilities(new byte[] {0}, SHARED)));
  }

  private static long originalBits(NavGraph graph) {
    var launch = graph.waypoint(0).launch().orElseThrow();
    return Double.doubleToRawLongBits(launch.takeoff().horizontalDistance(launch.runUpStart()));
  }

  @Test
  void preservesReconstructedBitsInsteadOfSubstitutingTheBakedScalarAcrossGraphs() {
    var first = graph(0);
    var translated = graph(1_000_000);
    var expectedFirst = originalBits(first);
    var expectedTranslated = originalBits(translated);
    assertThat(expectedFirst).isNotEqualTo(expectedTranslated);
    assertThat(expectedTranslated).isNotEqualTo(Double.doubleToRawLongBits(2));
    for (var attempt = 0; attempt < 3; attempt++) {
      assertThat(Double.doubleToRawLongBits(first.runUpDistance(0))).isEqualTo(expectedFirst);
      assertThat(Double.doubleToRawLongBits(translated.runUpDistance(0)))
          .isEqualTo(expectedTranslated);
    }
    assertThat(first).isEqualTo(graph(0));
    assertThat(first.hashCode()).isEqualTo(graph(0).hashCode());
  }

  @Test
  void concurrentReadersPublishOnlyTheOriginalCompleteDouble() throws Exception {
    var graph = graph(-1_000_000);
    var expected = originalBits(graph);
    var work = new ArrayList<Callable<Long>>();
    for (var index = 0; index < 32; index++)
      work.add(() -> Double.doubleToRawLongBits(graph.runUpDistance(0)));
    try (var executor = Executors.newFixedThreadPool(4)) {
      for (var result : executor.invokeAll(work)) assertThat(result.get()).isEqualTo(expected);
    }
  }

  @Test
  void knownSourceIsCheckedAndProducesTheSameCompleteWaypoint() {
    var graph = graph(0);
    assertThat(graph.edgeLeaves(0, 0)).isTrue();
    assertThat(graph.edgeLeaves(0, 1)).isFalse();
    assertThat(graph.edgeLeaves(0, -1)).isFalse();
    assertThat(graph.waypoint(0, 0)).isEqualTo(graph.waypoint(0));
    assertThatThrownBy(() -> graph.waypoint(0, 1)).isInstanceOf(IllegalArgumentException.class);
  }
}
