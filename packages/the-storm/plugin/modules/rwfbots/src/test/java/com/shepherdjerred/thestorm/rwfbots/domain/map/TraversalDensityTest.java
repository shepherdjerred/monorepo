package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import java.util.OptionalDouble;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

final class TraversalDensityTest {
  private static NavGraph course(float jumpTime) {
    var bounds = new GridBounds(new BlockPos(0, 0, 0), 4, 2, 1);
    return new NavGraph(
        bounds,
        new int[] {0, 1, 2, 3},
        new NavGraph.Topology(new int[] {0, 2, 3, 4, 4}, new int[] {1, 3, 2, 3}),
        new NavGraph.EdgeData(
            new byte[] {Hop.WALK.code(), Hop.LEAP.code(), Hop.WALK.code(), Hop.WALK.code()},
            new float[] {3, jumpTime, 3, 3}));
  }

  private static HealthRoutes.EdgePolicy policy(NavGraph graph, double density, boolean timed) {
    return new HealthRoutes.EdgePolicy(
            (edge, arrival) -> 0, new NavGraph.EdgeMotion(graph::edgeCost, edge -> true, 0), timed)
        .withToll(TraversalDensity.edges(graph, node -> density));
  }

  @Test
  void searchPassesKnownSourceAndComputedDurationToEachRelaxedEdgeToll() {
    var bounds = new GridBounds(new BlockPos(0, 0, 0), 2, 2, 1);
    var graph =
        new NavGraph(
            bounds,
            new int[] {0, 1},
            new NavGraph.Topology(new int[] {0, 1, 1}, new int[] {1}),
            new NavGraph.EdgeData(new byte[] {Hop.WALK.code()}, new float[] {3}));
    var durations = new AtomicInteger();
    var tolls = new AtomicInteger();
    var motion =
        new NavGraph.EdgeMotion(
            edge -> {
              durations.incrementAndGet();
              return 3;
            },
            edge -> true,
            0);
    NavGraph.EdgeToll toll =
        (edge, source, duration) -> {
          assertThat(edge).isZero();
          assertThat(source).isZero();
          assertThat(duration).isEqualTo(3);
          tolls.incrementAndGet();
          return 7;
        };
    var direct =
        graph
            .path(0, 1, new NavGraph.PathWeights(node -> 0, toll, motion), graph.workspace())
            .orElseThrow();
    assertThat(direct.cost()).isEqualTo(3);
    assertThat(tolls.get()).isEqualTo(1);
    // One relaxation and the existing physical-time path reconstruction; toll never recalculates
    // time.
    assertThat(durations.get()).isEqualTo(2);
    tolls.set(0);
    durations.set(0);
    var timed =
        HealthRoutes.find(
                graph,
                new HealthRoutes.Request(0, 1, 19, node -> 0),
                HealthRoutes.EdgePolicy.timed((edge, arrival) -> 0, motion).withToll(toll),
                null)
            .orElseThrow();
    assertThat(timed.path()).isEqualTo(direct);
    assertThat(timed.weightedCost()).isEqualTo(10);
    assertThat(tolls.get()).isEqualTo(1);
    assertThat(durations.get()).isEqualTo(1);
  }

  @Test
  void uniformDensityIsInvariantUnderCoarsening() {
    var whole = TraversalDensity.cost(12, 12, 13);
    var split =
        TraversalDensity.cost(12, 12, 3)
            + TraversalDensity.cost(12, 12, 4)
            + TraversalDensity.cost(12, 12, 6);
    assertThat(split).isCloseTo(whole, within(1e-12));
  }

  @Test
  void uniformExposureCannotRewardASlowerCompressedJump() {
    var graph = course(13);
    var request = new HealthRoutes.Request(0, 3, 19, node -> 0);
    var fast = HealthRoutes.find(graph, request, policy(graph, 12, false), null).orElseThrow();
    var timed = HealthRoutes.find(graph, request, policy(graph, 12, true), null).orElseThrow();
    assertThat(fast.path().nodes()).containsExactly(0, 1, 2, 3);
    assertThat(timed.path()).isEqualTo(fast.path());
    assertThat(timed.weightedCost()).isCloseTo(fast.weightedCost(), within(1e-12));
    assertThat(fast.path().cost()).isEqualTo(9);
  }

  @Test
  void zeroDensityPreservesATrulyFasterJump() {
    var graph = course(5);
    var route =
        HealthRoutes.find(
                graph, new HealthRoutes.Request(0, 3, 19, node -> 0), policy(graph, 0, false), null)
            .orElseThrow();
    assertThat(route.path().nodes()).containsExactly(0, 3);
    assertThat(route.path().cost()).isEqualTo(5);
    assertThat(route.weightedCost()).isEqualTo(5);
  }

  @Test
  void densityNeverAdvancesProtectionExpiryOrArrivalDeadlines() {
    var graph = course(13);
    var request =
        new HealthRoutes.Request(
            0, 3, new HealthRoutes.RiskPolicy(0, 0, OptionalDouble.of(9)), node -> 0);
    var motion = new NavGraph.EdgeMotion(graph::edgeCost, edge -> true, 0);
    var edges =
        HealthRoutes.EdgePolicy.timed((edge, arrival) -> arrival <= 9 ? 0 : 20, motion)
            .withToll(TraversalDensity.edges(graph, node -> 100));
    var route = HealthRoutes.find(graph, request, edges, null).orElseThrow();
    assertThat(route.path().cost()).isEqualTo(9);
    assertThat(route.weightedCost()).isGreaterThan(100);
    assertThat(route.damage()).isZero();
  }
}
