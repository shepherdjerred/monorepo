package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.BitSet;
import java.util.List;
import java.util.Optional;
import java.util.SplittableRandom;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

final class DirectedReachabilityTest {
  @Test
  void commonSpawnReachabilityPreservesDirectionsMissingSpawnsDuplicatesAndOwnedResults() {
    var edges = new int[][] {{1}, {0, 2}, {3}, {}, {2}, {}};
    var graph = graph(edges);
    var sources = new int[] {0, 1, 4, 4};
    assertThat(graph.reachableFromAll(sources)).isEqualTo(common(edges, sources));
    assertThat(graph.reachable(0, 3)).isTrue();
    assertThat(graph.reachable(3, 0)).isFalse();
    assertThat(graph.reachable(5, 5)).isTrue();
    var sites =
        new NavSites(
            List.of(
                site("first", 0),
                site("same-component", 1),
                site("other-team", 4),
                site("missing", 8)),
            List.of());
    assertThat(ApproachNodes.reachableFromSpawns(graph, sites)).isEqualTo(common(edges, sources));
    var returned = graph.reachableFromAll(sources);
    returned.clear();
    assertThat(graph.reachableFromAll(sources)).isEqualTo(common(edges, sources));
    assertThat(graph.reachableFromAll(new int[0]).cardinality()).isEqualTo(edges.length);
    assertThatThrownBy(() -> graph.reachable(-1, 0)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> graph.reachable(0, edges.length))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> graph.reachableFromAll(new int[] {0, -1}))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void independentDfsAndWeightedSearchAgreeAcrossSeededDirectedGraphs() {
    var random = new SplittableRandom(12345);
    for (var trial = 0; trial < 24; trial++) {
      var edges = new int[24][];
      for (var source = 0; source < edges.length; source++)
        edges[source] =
            IntStream.range(0, edges.length).filter(target -> random.nextInt(8) == 0).toArray();
      var graph = graph(edges);
      for (var source = 0; source < edges.length; source++) {
        var expected = dfs(edges, source);
        var costs = graph.costsFrom(source);
        for (var target = 0; target < edges.length; target++) {
          assertThat(graph.reachable(source, target)).isEqualTo(expected.get(target));
          assertThat(Float.isFinite(costs[target])).isEqualTo(expected.get(target));
        }
        var sources = new int[] {source, (source + 7) % edges.length, source};
        assertThat(graph.reachableFromAll(sources)).isEqualTo(common(edges, sources));
      }
    }
  }

  @Test
  void condensationAboveTheClosureBudgetUsesExactReusableDfsScratch() {
    var edges = new int[9000][];
    for (var source = 0; source < edges.length; source++)
      edges[source] = source + 1 < edges.length ? new int[] {source + 1} : new int[0];
    var graph = graph(edges);
    for (var source : new int[] {0, 4500, 8999, 0, 4500}) {
      var expected = dfs(edges, source);
      for (var target : new int[] {0, 100, 4499, 4500, 8999})
        assertThat(graph.reachable(source, target)).isEqualTo(expected.get(target));
    }
    var sources = new int[] {0, 4500, 4500};
    assertThat(graph.reachableFromAll(sources)).isEqualTo(common(edges, sources));
    graph.reachableFromAll(sources).set(0, edges.length);
    assertThat(graph.reachable(8999, 0)).isFalse();
    assertThat(graph.reachableFromAll(sources)).isEqualTo(common(edges, sources));
  }

  @Test
  void anEmptyGraphAndEmptySpawnListRemainEmpty() {
    var graph = graph(new int[0][]);
    assertThat(graph.reachableFromAll(new int[0]).isEmpty()).isTrue();
    assertThat(
            ApproachNodes.reachableFromSpawns(graph, new NavSites(List.of(), List.of())).isEmpty())
        .isTrue();
  }

  private static NavSites.Site site(String name, int x) {
    return new NavSites.Site(name, Optional.empty(), new BlockPos(x, 0, 0));
  }

  private static NavGraph graph(int[][] edges) {
    var starts = new int[edges.length + 1];
    for (var source = 0; source < edges.length; source++)
      starts[source + 1] = starts[source] + edges[source].length;
    var targets = Arrays.stream(edges).flatMapToInt(Arrays::stream).toArray();
    var hops = new byte[targets.length];
    Arrays.fill(hops, Hop.WALK.code());
    var costs = new float[targets.length];
    for (var edge = 0; edge < costs.length; edge++) costs[edge] = (edge % 7) * 0.25f;
    return new NavGraph(
        new GridBounds(new BlockPos(0, 0, 0), Math.max(1, edges.length), 1, 1),
        IntStream.range(0, edges.length).toArray(),
        new NavGraph.Topology(starts, targets),
        new NavGraph.EdgeData(hops, costs));
  }

  private static BitSet common(int[][] edges, int[] sources) {
    var result = new BitSet(edges.length);
    result.set(0, edges.length);
    for (var source : sources) result.and(dfs(edges, source));
    return result;
  }

  /** Independent oracle uses raw adjacency, not graph components, searches, costs or closure. */
  private static BitSet dfs(int[][] edges, int source) {
    var reached = new BitSet(edges.length);
    var stack = new ArrayDeque<Integer>();
    stack.push(source);
    reached.set(source);
    while (!stack.isEmpty()) {
      for (var target : edges[stack.pop()]) {
        if (!reached.get(target)) {
          reached.set(target);
          stack.push(target);
        }
      }
    }
    return reached;
  }
}
