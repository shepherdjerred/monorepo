package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.OptionalDouble;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

/** Exhaustive path enumeration independent of the production priority queue and dominance rule. */
final class HealthRoutesOracleTest {
  private record Course(NavGraph graph, List<Integer> damage, List<Double> tolls) {}

  private record Prefix(int node, int spent, double ticks, double cost) {}

  @Test
  void preservesEqualPrefixPreferenceAndTheWeightedOptimumWhenSuffixRoundingCollapsesCosts() {
    for (var fastCost : new double[] {2, Math.nextUp(2d)}) {
      var bounds = new GridBounds(new BlockPos(0, 0, 0), 3, 1, 1);
      var graph =
          new NavGraph(
              bounds,
              new int[] {0, 1, 2},
              new NavGraph.Topology(new int[] {0, 3, 4, 4}, new int[] {1, 1, 2, 2}),
              new NavGraph.EdgeData(
                  new byte[] {Hop.WALK.code(), Hop.JUMP.code(), Hop.DROP.code(), Hop.WALK.code()},
                  new float[] {2, 1, 1, 1}));
      var course =
          new Course(graph, List.of(0, 0, 1, 0), List.of(0d, fastCost - 1, 0d, Math.scalb(1d, 55)));
      HealthRoutes.DamageAt damage = (edge, arrival) -> course.damage().get(edge);
      var edges =
          new HealthRoutes.EdgePolicy(
                  damage, new NavGraph.EdgeMotion(graph::edgeCost, edge -> true, 1), false)
              .withToll((edge, source, duration) -> course.tolls().get(edge));
      var request = new HealthRoutes.Request(0, 2, 0, node -> 0);
      var route = HealthRoutes.find(graph, request, edges, null).orElseThrow();
      var expected = enumerate(course, request, damage, new Prefix(0, 0, 0, 0));
      assertThat(route.weightedCost()).isEqualTo(expected);
      assertThat(route.damage()).isZero();
      // Equal prefix costs keep the faster path. A strict prefix improvement can become a
      // final rounded tie; its physical route need not equal the old three-axis preference.
      assertThat(route.path().cost()).isEqualTo(fastCost == 2 ? 2 : 3);
    }
  }

  @Test
  void matchesEveryFeasiblePathOnStaticTimedAndDeadlineCourses() {
    for (var seed = 0; seed < 24; seed++) {
      var course = course(seed);
      for (var timed : new boolean[] {false, true}) {
        for (var deadline : new double[] {-1, 12, 24}) {
          verify(course, seed % 6, timed, deadline);
        }
      }
    }
  }

  private static void verify(Course course, int budget, boolean timed, double deadline) {
    var risk =
        new HealthRoutes.RiskPolicy(
            budget, 1.5, deadline < 0 ? OptionalDouble.empty() : OptionalDouble.of(deadline));
    var graph = course.graph();
    var motion = new NavGraph.EdgeMotion(graph::edgeCost, edge -> true, 1);
    HealthRoutes.DamageAt damage =
        (edge, arrival) -> course.damage().get(edge) + (timed && arrival > 10 ? 1 : 0);
    var edges =
        new HealthRoutes.EdgePolicy(damage, motion, timed)
            .withToll((edge, source, duration) -> course.tolls().get(edge));
    var request = new HealthRoutes.Request(0, graph.nodeCount() - 1, risk, node -> 0);
    var expected = enumerate(course, request, damage, new Prefix(0, 0, 0, 0));
    var actual = HealthRoutes.find(graph, request, edges, null);
    assertThat(actual.isPresent()).isEqualTo(Double.isFinite(expected));
    actual.ifPresent(
        route -> {
          assertThat(route.weightedCost()).isCloseTo(expected, within(1e-9));
          assertThat(route.damage()).isLessThanOrEqualTo((int) risk.damageBudget());
          assertThat(risk.allows(route.path().cost())).isTrue();
        });
  }

  @Test
  void prunesExpensiveStaticPrefixesWithoutEnumeratingEveryArrivalTime() {
    var course = diamonds(12);
    var calls = new AtomicInteger();
    var graph = course.graph();
    var motion = new NavGraph.EdgeMotion(graph::edgeCost, edge -> true, 1);
    var edges =
        new HealthRoutes.EdgePolicy(edge -> course.damage().get(edge), motion)
            .withToll(
                (edge, source, duration) -> {
                  calls.incrementAndGet();
                  return course.tolls().get(edge);
                });
    var route =
        HealthRoutes.find(
                graph,
                new HealthRoutes.Request(0, graph.nodeCount() - 1, 0, node -> 0),
                edges,
                null)
            .orElseThrow();
    assertThat(route.damage()).isZero();
    assertThat(route.path().cost()).isEqualTo(12 + 4095 + 3 * 4096);
    assertThat(calls.get()).isLessThan(200);
  }

  @Test
  void aDeadlineRetainsTheMoreExpensiveFasterPrefixes() {
    var course = diamonds(8);
    var graph = course.graph();
    var deadline = 8 + 3 * 256;
    var request =
        new HealthRoutes.Request(
            0,
            graph.nodeCount() - 1,
            new HealthRoutes.RiskPolicy(0, 0, OptionalDouble.of(deadline)),
            node -> 0);
    var edges =
        new HealthRoutes.EdgePolicy(
                edge -> course.damage().get(edge),
                new NavGraph.EdgeMotion(graph::edgeCost, edge -> true, 1))
            .withToll((edge, source, duration) -> course.tolls().get(edge));
    var route = HealthRoutes.find(graph, request, edges, null).orElseThrow();
    assertThat(route.path().cost()).isEqualTo(deadline);
    assertThat(route.weightedCost()).isEqualTo(deadline + 2 * 255);
  }

  private static Course diamonds(int depth) {
    var bounds = new GridBounds(new BlockPos(0, 0, 0), depth + 2, 1, 1);
    var starts = new int[depth + 3];
    var cells = new int[depth + 2];
    var targets = new int[2 * (depth + 1)];
    var costs = new float[targets.length];
    var hops = new byte[targets.length];
    var damage = new ArrayList<Integer>();
    var tolls = new ArrayList<Double>();
    for (var i = 0; i <= depth; i++) {
      starts[i] = i * 2;
      cells[i] = bounds.index(i, 0, 0);
      targets[i * 2] = i + 1;
      targets[i * 2 + 1] = i + 1;
      costs[i * 2] = i == depth ? 1 : 1 + (1 << i);
      costs[i * 2 + 1] = i == depth ? 3 * (1 << depth) : 1;
      hops[i * 2] = i == depth ? Hop.DROP.code() : Hop.WALK.code();
      hops[i * 2 + 1] = Hop.JUMP.code();
      damage.add(i == depth ? 1 : 0);
      damage.add(0);
      tolls.add(0.0);
      tolls.add(i == depth ? 0 : (double) (1 << (i + 1)));
    }
    cells[depth + 1] = bounds.index(depth + 1, 0, 0);
    starts[depth + 1] = targets.length;
    starts[depth + 2] = targets.length;
    return new Course(
        new NavGraph(
            bounds,
            cells,
            new NavGraph.Topology(starts, targets),
            new NavGraph.EdgeData(hops, costs)),
        List.copyOf(damage),
        List.copyOf(tolls));
  }

  private static double enumerate(
      Course course, HealthRoutes.Request request, HealthRoutes.DamageAt damage, Prefix prefix) {
    var node = prefix.node();
    var ticks = prefix.ticks();
    var spent = prefix.spent();
    var cost = prefix.cost();
    if (node == request.to()) return cost;
    var graph = course.graph();
    var best = Double.POSITIVE_INFINITY;
    for (var edge = graph.edgeStart(node); edge < graph.edgeEnd(node); edge++) {
      var arrival = ticks + graph.edgeCost(edge);
      var loss = damage.damage(edge, arrival);
      if (spent + loss > request.damageBudget() || !request.risk().allows(arrival)) continue;
      var candidate =
          enumerate(
              course,
              request,
              damage,
              new Prefix(
                  graph.edgeTarget(edge),
                  spent + loss,
                  arrival,
                  cost
                      + graph.edgeCost(edge)
                      + loss * request.risk().ticksPerHealthPoint()
                      + course.tolls().get(edge)));
      best = Math.min(best, candidate);
    }
    return best;
  }

  private static Course course(int seed) {
    var size = 8;
    var bounds = new GridBounds(new BlockPos(0, 0, 0), size, 1, 1);
    var starts = new int[size + 1];
    var targets = new ArrayList<Integer>();
    var costs = new ArrayList<Float>();
    var damages = new ArrayList<Integer>();
    var tolls = new ArrayList<Double>();
    for (var from = 0; from < size; from++) {
      starts[from] = targets.size();
      for (var to = from + 1; to < size; to++) {
        var key = from * 31 + to * 17 + seed;
        if (to != from + 1 && key % 3 != 0) continue;
        targets.add(to);
        costs.add((float) (1 + key % 7));
        damages.add(key % 4);
        tolls.add((key % 5) * 0.5);
      }
    }
    starts[size] = targets.size();
    var hops = new byte[targets.size()];
    Arrays.fill(hops, Hop.WALK.code());
    var weights = new float[costs.size()];
    for (var i = 0; i < weights.length; i++) {
      weights[i] = costs.get(i);
    }
    var cells = new int[size];
    for (var i = 0; i < size; i++) cells[i] = bounds.index(i, 0, 0);
    return new Course(
        new NavGraph(
            bounds,
            cells,
            new NavGraph.Topology(starts, targets.stream().mapToInt(Integer::intValue).toArray()),
            new NavGraph.EdgeData(hops, weights)),
        List.copyOf(damages),
        List.copyOf(tolls));
  }
}
