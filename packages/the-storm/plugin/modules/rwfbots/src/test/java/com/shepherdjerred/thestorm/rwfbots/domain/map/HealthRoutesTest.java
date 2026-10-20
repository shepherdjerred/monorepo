package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.OptionalDouble;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

final class HealthRoutesTest {
  private static final int[] DAMAGE = {3, 0, 0, 0, 3};

  private static NavGraph course() {
    var bounds = new GridBounds(new BlockPos(0, 0, 0), 4, 2, 1);
    int[] cells = {
      bounds.index(0, 0, 0),
      bounds.index(1, 0, 0),
      bounds.index(0, 1, 0),
      bounds.index(2, 0, 0),
      bounds.index(3, 0, 0)
    };
    byte[] hops = {
      Hop.DROP.code(), Hop.WALK.code(), Hop.WALK.code(), Hop.WALK.code(), Hop.DROP.code()
    };
    return new NavGraph(
        bounds,
        cells,
        new NavGraph.Topology(new int[] {0, 2, 3, 4, 5, 5}, new int[] {1, 2, 3, 3, 4}),
        new NavGraph.EdgeData(hops, new float[] {1, 2, 1, 3, 1}));
  }

  @Test
  void blockPenaltiesChargeTheFullPrimitiveWithoutInflatingTravelTime() {
    var graph = course();
    for (var timed : new boolean[] {false, true}) {
      var motion = new NavGraph.EdgeMotion(graph::edgeCost, edge -> true, 1);
      var edges = new HealthRoutes.EdgePolicy((edge, arrival) -> 0, motion, timed);
      var route =
          HealthRoutes.find(
                  graph,
                  new HealthRoutes.Request(
                      2,
                      3,
                      new HealthRoutes.RiskPolicy(0, 0, OptionalDouble.of(3)),
                      node -> 5,
                      HealthRoutes.PenaltyUnits.BLOCK),
                  edges,
                  null)
              .orElseThrow();
      assertThat(route.path().nodes()).containsExactly(2, 3);
      assertThat(route.path().cost()).isEqualTo(3);
      assertThat(route.weightedCost()).isCloseTo(3 + 5 * Math.sqrt(5), within(1e-9));
    }
  }

  @Test
  void preservesASlowerSafePrefixWhenAFasterPrefixWouldExhaustTheCumulativeBudget() {
    var path =
        HealthRoutes.find(
                course(), new HealthRoutes.Request(0, 4, 3, node -> 0), edge -> DAMAGE[edge])
            .orElseThrow();
    assertThat(path.path().nodes()).containsExactly(0, 2, 3, 4);
    assertThat(path.damage()).isEqualTo(3);
    assertThat(path.path().cost()).isEqualTo(6);
  }

  @Test
  void acceptsIntentionalDamageWhenTheEntireRouteFitsTheBudget() {
    var path =
        HealthRoutes.find(
                course(), new HealthRoutes.Request(0, 4, 6, node -> 0), edge -> DAMAGE[edge])
            .orElseThrow();
    assertThat(path.path().nodes()).containsExactly(0, 1, 3, 4);
    assertThat(path.damage()).isEqualTo(6);
  }

  @Test
  void temporaryProtectionMustLastUntilEachLandingAcrossTheEntireRoute() {
    var graph = course();
    var motion = new NavGraph.EdgeMotion(graph::edgeCost, edge -> true, 1);
    var protection =
        HealthRoutes.EdgePolicy.timed((edge, arrival) -> arrival <= 2 ? 0 : DAMAGE[edge], motion);
    var route =
        HealthRoutes.find(graph, new HealthRoutes.Request(0, 4, 3, node -> 0), protection, null)
            .orElseThrow();
    assertThat(route.path().nodes()).containsExactly(0, 1, 3, 4);
    assertThat(route.damage()).isEqualTo(3);
    assertThat(
            HealthRoutes.find(
                graph, new HealthRoutes.Request(0, 4, 2, node -> 0), protection, null))
        .isEmpty();
  }

  @Test
  void healthValuePrefersASaferRouteUnlessARealArrivalDeadlineRequiresTheDamagingShortcut() {
    var ordinary =
        HealthRoutes.find(
                course(),
                new HealthRoutes.Request(0, 4, new HealthRoutes.RiskPolicy(6, 4), node -> 0),
                edge -> DAMAGE[edge])
            .orElseThrow();
    assertThat(ordinary.path().nodes()).containsExactly(0, 2, 3, 4);
    var urgent =
        HealthRoutes.find(
                course(),
                new HealthRoutes.Request(
                    0, 4, new HealthRoutes.RiskPolicy(6, 4, OptionalDouble.of(4)), node -> 0),
                edge -> DAMAGE[edge])
            .orElseThrow();
    assertThat(urgent.path().nodes()).containsExactly(0, 1, 3, 4);
    assertThat(urgent.path().cost()).isLessThanOrEqualTo(4);
    assertThat(urgent.damage()).isEqualTo(6);
  }

  @Test
  void rejectsRoutesWhoseFinalDropCannotFitEvenAfterTheSafeDetour() {
    assertThat(
            HealthRoutes.find(
                course(), new HealthRoutes.Request(0, 4, 2, node -> 0), edge -> DAMAGE[edge]))
        .isEmpty();
  }

  /**
   * A square of open ground whose far corner leads into a long corridor, every edge one tick: the
   * corridor's end lies further than the deadline from anywhere in the square.
   */
  private static NavGraph squareAndCorridor(int side, int corridor) {
    var bounds = new GridBounds(new BlockPos(0, 0, 0), side + corridor, 1, side);
    var cells = new ArrayList<Integer>();
    for (var x = 0; x < side; x++) for (var z = 0; z < side; z++) cells.add(bounds.index(x, 0, z));
    for (var x = side; x < side + corridor; x++) cells.add(bounds.index(x, 0, 0));
    var nodeOf = new HashMap<Integer, Integer>();
    for (var node = 0; node < cells.size(); node++) nodeOf.put(cells.get(node), node);
    var starts = new int[cells.size() + 1];
    var targets = new ArrayList<Integer>();
    for (var node = 0; node < cells.size(); node++) {
      starts[node] = targets.size();
      targets.addAll(neighbours(bounds, nodeOf, bounds.cell(cells.get(node))));
    }
    starts[cells.size()] = targets.size();
    var hops = new byte[targets.size()];
    Arrays.fill(hops, Hop.WALK.code());
    var costs = new float[targets.size()];
    Arrays.fill(costs, 1);
    return new NavGraph(
        bounds,
        cells.stream().mapToInt(Integer::intValue).toArray(),
        new NavGraph.Topology(starts, targets.stream().mapToInt(Integer::intValue).toArray()),
        new NavGraph.EdgeData(hops, costs));
  }

  private static List<Integer> neighbours(
      GridBounds bounds, Map<Integer, Integer> nodeOf, BlockPos cell) {
    var out = new ArrayList<Integer>();
    for (var step : new int[][] {{1, 0}, {-1, 0}, {0, 1}, {0, -1}}) {
      var x = cell.x() + step[0];
      var z = cell.z() + step[1];
      if (!bounds.contains(x, 0, z)) continue;
      var next = nodeOf.get(bounds.index(x, 0, z));
      if (next != null) out.add(next);
    }
    return out;
  }

  @Test
  void aGoalThatCannotBeReachedByTheDeadlineIsRejectedWithoutSearchingTheGroundAroundTheBot() {
    var side = 60;
    var graph = squareAndCorridor(side, 150);
    var checked = new AtomicInteger();
    var motion =
        new NavGraph.EdgeMotion(
            graph::edgeCost,
            edge -> {
              checked.incrementAndGet();
              return true;
            },
            1);
    var late =
        new HealthRoutes.Request(
            0,
            graph.nodeCount() - 1,
            new HealthRoutes.RiskPolicy(20, 1, OptionalDouble.of(100)),
            node -> 0);
    for (var timed : new boolean[] {false, true}) {
      checked.set(0);
      var edges = new HealthRoutes.EdgePolicy((edge, arrival) -> 0, motion, timed);
      assertThat(HealthRoutes.find(graph, late, edges, null)).isEmpty();
      // The square alone has over 14,000 edges, nearly all within the deadline of the bot.
      assertThat(checked.get()).isLessThan(side * side);
    }
  }

  @Test
  void staysAtTheSourceWithoutSpendingHealthAndRejectsCorruptDamage() {
    var still =
        HealthRoutes.find(
                course(), new HealthRoutes.Request(0, 0, 0, node -> 0), edge -> DAMAGE[edge])
            .orElseThrow();
    assertThat(still.path().nodes()).containsExactly(0);
    assertThat(still.damage()).isZero();
    assertThatThrownBy(
            () ->
                HealthRoutes.find(
                    course(), new HealthRoutes.Request(0, 4, 5, node -> 0), edge -> -1))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("edge damage");
  }
}
