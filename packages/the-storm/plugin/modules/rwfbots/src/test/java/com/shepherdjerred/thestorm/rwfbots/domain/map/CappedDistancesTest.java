package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import java.util.ArrayList;
import java.util.SplittableRandom;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

final class CappedDistancesTest {
  @Test
  void reachableOverCapIsDistinctFromUnreachableInBothDirections() {
    var graph = graph(4, new int[] {0, 1, 2, 2, 2}, new int[] {1, 2}, new float[] {129, 1});
    var workspace = graph.workspace();
    assertThat(graph.cappedCostsToTargets(0, new int[] {0, 1, 2, 3, -1, 1}, 128, workspace))
        .containsExactly(0, 128, 128, Float.POSITIVE_INFINITY, Float.POSITIVE_INFINITY, 128);
    assertThat(graph.cappedCostsToTargets(2, new int[] {0, 1, 2}, 128, workspace))
        .containsExactly(Float.POSITIVE_INFINITY, Float.POSITIVE_INFINITY, 0);
    assertThat(graph.cappedCostsToTargets(0, new int[] {0, 2, 3}, 0, workspace))
        .containsExactly(0, 0, Float.POSITIVE_INFINITY);
  }

  @Test
  void cappedFloatsMatchFullDijkstraAcrossDirectedCyclesAndDisconnectedComponents() {
    var random = new SplittableRandom(196);
    for (var sample = 0; sample < 40; sample++) {
      var graph = randomGraph(random, 24);
      var targets = IntStream.range(-1, graph.nodeCount()).toArray();
      var workspace = graph.workspace();
      for (var from = 0; from < graph.nodeCount(); from++) {
        var exact = graph.costsFrom(from);
        for (var cap : new float[] {0, 0.5f, 128, 1000}) {
          var actual = graph.cappedCostsToTargets(from, targets, cap, workspace);
          assertCapped(exact, targets, cap, actual);
        }
      }
    }
  }

  private static void assertCapped(float[] exact, int[] targets, float cap, float[] actual) {
    for (var i = 0; i < targets.length; i++) {
      var expected =
          targets[i] < 0 || !Float.isFinite(exact[targets[i]])
              ? Float.POSITIVE_INFINITY
              : Math.min(cap, exact[targets[i]]);
      assertThat(Float.floatToIntBits(actual[i])).isEqualTo(Float.floatToIntBits(expected));
    }
  }

  @Test
  void largeCondensationsKeepExactReachabilityWithoutAllocatingAQuadraticClosure() {
    var nodes = 9000;
    var start = new int[nodes + 1];
    var to = new int[nodes - 1];
    var costs = new float[nodes - 1];
    for (var node = 0; node < nodes; node++) {
      start[node] = Math.min(node, nodes - 1);
      if (node < nodes - 1) {
        to[node] = node + 1;
        costs[node] = 1;
      }
    }
    start[nodes] = nodes - 1;
    var graph = graph(nodes, start, to, costs);
    var workspace = graph.workspace();
    assertThat(graph.cappedCostsToTargets(0, new int[] {0, 1, nodes - 1}, 128, workspace))
        .containsExactly(0, 1, 128);
    assertThat(graph.cappedCostsToTargets(nodes - 1, new int[] {0, nodes - 1}, 128, workspace))
        .containsExactly(Float.POSITIVE_INFINITY, 0);
    assertThat(graph.path(0, 1, ignored -> 0, workspace)).isEqualTo(graph.path(0, 1));
  }

  @Test
  void invalidRequestsReleaseBorrowedStorageAndCannotNestSearches() {
    var graph = graph(2, new int[] {0, 1, 1}, new int[] {1}, new float[] {1});
    var workspace = graph.workspace();
    assertThatThrownBy(() -> graph.cappedCostsToTargets(0, new int[] {2}, 128, workspace))
        .isInstanceOf(IllegalArgumentException.class);
    for (var cap : new float[] {-1, Float.NaN, Float.POSITIVE_INFINITY}) {
      assertThatThrownBy(() -> graph.cappedCostsToTargets(0, new int[] {1}, cap, workspace))
          .isInstanceOf(IllegalArgumentException.class);
    }
    assertThatThrownBy(() -> graph.cappedCostsToTargets(-1, new int[] {1}, 128, workspace))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                graph.path(
                    0,
                    1,
                    ignored -> {
                      graph.cappedCostsToTargets(0, new int[] {1}, 128, workspace);
                      return 0;
                    },
                    workspace))
        .isInstanceOf(IllegalStateException.class);
    assertThat(graph.cappedCostsToTargets(0, new int[] {1}, 128, workspace)).containsExactly(1);
    assertThat(graph.cappedCostsToTargets(0, new int[0], 128, workspace)).isEmpty();
  }

  private static NavGraph randomGraph(SplittableRandom random, int nodes) {
    var start = new int[nodes + 1];
    var to = new ArrayList<Integer>();
    var costs = new ArrayList<Float>();
    var weights = new float[] {0, 0.1f, 1.41421f, 5, 127, 128, 129};
    for (var node = 0; node < nodes; node++) {
      for (var next = 0; next < nodes; next++) {
        if (random.nextInt(12) == 0) {
          to.add(next);
          costs.add(weights[random.nextInt(weights.length)]);
        }
      }
      start[node + 1] = to.size();
    }
    var values = new float[costs.size()];
    for (var i = 0; i < values.length; i++) values[i] = costs.get(i);
    return graph(nodes, start, to.stream().mapToInt(Integer::intValue).toArray(), values);
  }

  private static NavGraph graph(int nodes, int[] start, int[] to, float[] costs) {
    return new NavGraph(
        new GridBounds(new BlockPos(0, 0, 0), nodes, 1, 1),
        IntStream.range(0, nodes).toArray(),
        new NavGraph.Topology(start, to),
        new NavGraph.EdgeData(new byte[to.length], costs));
  }
}
