package com.shepherdjerred.thestorm.tools.rwfmap;

import static java.nio.charset.StandardCharsets.UTF_8;
import static java.util.Comparator.comparingInt;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.map.ApproachRoutes;
import com.shepherdjerred.thestorm.rwfbots.domain.map.Chokepoints;
import com.shepherdjerred.thestorm.rwfbots.domain.map.CoverPoints;
import com.shepherdjerred.thestorm.rwfbots.domain.map.EdgeCapabilities;
import com.shepherdjerred.thestorm.rwfbots.domain.map.FlowField;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.LaunchData;
import com.shepherdjerred.thestorm.rwfbots.domain.map.MapBaker;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavCodec;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavSites;
import com.shepherdjerred.thestorm.rwfbots.domain.map.Regions;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.team.BombScreens;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.BitSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

final class HealthAuditTest {
  private record Edge(int from, int to, int damage) {}

  private static NavGraph graph(int nodes, List<Edge> input) {
    var bounds = new GridBounds(new BlockPos(0, 0, 0), nodes, 4, 1);
    var cells =
        java.util.stream.IntStream.range(0, nodes).map(x -> bounds.index(x, 1, 0)).toArray();
    var edges = input.stream().sorted(comparingInt(Edge::from)).toList();
    var starts = new int[nodes + 1];
    for (var edge : edges) starts[edge.from() + 1]++;
    for (var node = 1; node <= nodes; node++) starts[node] += starts[node - 1];
    var targets = edges.stream().mapToInt(Edge::to).toArray();
    var damage = edges.stream().mapToInt(Edge::damage).toArray();
    var hops = new byte[edges.size()];
    var cost = new float[edges.size()];
    for (var index = 0; index < edges.size(); index++) {
      hops[index] = damage[index] == 0 ? Hop.WALK.code() : Hop.DROP.code();
      cost[index] = damage[index] == 0 ? 10 : 1;
    }
    return new NavGraph(
        bounds,
        cells,
        new NavGraph.Topology(starts, targets),
        new NavGraph.EdgeData(hops, cost, new EdgeCapabilities(damage, LaunchData.standard(hops))));
  }

  private static NavArtifact map(int finalDamage, List<Integer> workers) {
    var graph =
        graph(
            5,
            List.of(
                new Edge(0, 1, 10),
                new Edge(0, 2, 0),
                new Edge(1, 3, 10),
                new Edge(2, 1, 5),
                new Edge(3, 4, finalDamage),
                new Edge(4, 3, 0)));
    var sites =
        new NavSites(
            List.of(
                new NavSites.Site("spawn-a", Optional.of("red"), graph.cell(0)),
                new NavSites.Site("spawn-b", Optional.of("blue"), graph.cell(1))),
            List.of(new NavSites.Site("bomb", Optional.of("red"), graph.cell(3))));
    var empty = new BitSet();
    return new NavArtifact(
        NavCodec.FORMAT_VERSION,
        MapBaker.GENERATOR_VERSION,
        "tiny-health",
        "0".repeat(64),
        sites,
        new VoxelGrid(graph.bounds(), empty, empty, empty),
        graph,
        new Regions(new int[5], List.of(graph.feet(0)), empty),
        new CoverPoints(List.of()),
        new Chokepoints(List.of()),
        new ApproachRoutes(List.of()),
        Map.of("bomb", FlowField.toward(graph, 3).distance()),
        new BombScreens(Map.of("bomb", new BombScreens.Layout(workers, List.of(), 0))));
  }

  @Test
  void slowerLowDamageRouteAuditsEverySpawnAndEverySelectedWorker() {
    var report = HealthAudit.of(map(0, List.of(3, 4)));
    assertThat(report.healthBudget()).isEqualTo(19);
    assertThat(report.passed()).isTrue();
    assertThat(report.sites())
        .extracting(HealthAudit.Site::spawn)
        .containsExactly("spawn-a", "spawn-b");
    assertThat(report.sites().getFirst().canonicalDamageWithinBudget()).isEqualTo(15);
    assertThat(report.sites().getFirst().workers())
        .containsExactly(new HealthAudit.Worker(3, 15), new HealthAudit.Worker(4, 15));
    var json = JsonMapper.builder().build().readTree(report.json());
    assertThat(json.size()).isEqualTo(7);
    assertThat(json.path("map").asString()).isEqualTo("tiny-health");
    assertThat(json.path("everySelectedWorkerSafe").asBoolean()).isTrue();
    assertThat(json.path("sites").size()).isEqualTo(2);
  }

  @Test
  void oneSafeWorkerCannotHideAnotherWorkerWhoseCumulativeDamageIsLethal() {
    var report = HealthAudit.of(map(5, List.of(3, 4)));
    assertThat(report.everyObjectiveHasSafeWorker()).isTrue();
    assertThat(report.everySelectedWorkerSafe()).isFalse();
    assertThat(report.passed()).isFalse();
    assertThat(report.sites().getFirst().workers())
        .containsExactly(new HealthAudit.Worker(3, 15), new HealthAudit.Worker(4, -1));
    assertThat(report.sites().getLast().allWorkersSafe()).isTrue();
    assertThat(HealthAudit.of(map(0, List.of())).passed()).isFalse();
  }

  @Test
  void unsafeCommandReportsEveryFindingAndReturnsFailureWithoutDroppingTheJson() {
    var report = HealthAudit.of(map(5, List.of(3, 4)));
    var out = new ByteArrayOutputStream();
    var err = new ByteArrayOutputStream();
    assertThat(
            RwfMap.healthReport(
                report, new PrintStream(out, true, UTF_8), new PrintStream(err, true, UTF_8)))
        .isEqualTo(RwfMap.FAILED);
    var json = JsonMapper.builder().build().readTree(out.toString(UTF_8));
    assertThat(json.path("sites").size()).isEqualTo(2);
    assertThat(json.path("everySelectedWorkerSafe").asBoolean()).isFalse();
    assertThat(err.toString(UTF_8)).contains("tiny-health").contains("19 HP");
  }

  @Test
  void wideFallsNeverOverflowIntoTheOrdinaryBudgetAndBudgetZeroRetainsSafeCycles() {
    var graph =
        graph(3, List.of(new Edge(0, 1, Integer.MAX_VALUE), new Edge(0, 2, 19), new Edge(2, 1, 1)));
    assertThat(HealthAudit.minimumDamage(graph, 0, 19)).containsExactly(0, -1, 19);
    assertThat(HealthAudit.minimumDamage(graph, 0, 20)).containsExactly(0, 20, 19);
    var cycle = graph(3, List.of(new Edge(0, 1, 0), new Edge(1, 0, 0), new Edge(1, 2, 1)));
    assertThat(HealthAudit.minimumDamage(cycle, 0, 0)).containsExactly(0, 0, -1);
    assertThatThrownBy(() -> HealthAudit.minimumDamage(cycle, 3, 19))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> HealthAudit.minimumDamage(cycle, 0, -1))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void budgetedSearchMatchesIndependentFloydWarshallOracleOnDirectedGraphs() {
    var random = new SplittableRandom(196);
    for (var run = 0; run < 40; run++) {
      var count = random.nextInt(2, 9);
      var edges = randomEdges(count, random);
      var graph = graph(count, edges);
      var expected = oracle(count, edges);
      for (var source = 0; source < count; source++) {
        for (var budget : List.of(0, 3, 19, 32)) {
          var row =
              Arrays.stream(expected[source])
                  .mapToInt(value -> value <= budget ? (int) value : -1)
                  .toArray();
          assertThat(HealthAudit.minimumDamage(graph, source, budget)).containsExactly(row);
        }
      }
    }
  }

  private static List<Edge> randomEdges(int nodes, SplittableRandom random) {
    var edges = new ArrayList<Edge>();
    for (var from = 0; from < nodes; from++) {
      for (var to = 0; to < nodes; to++) {
        if (from != to && random.nextBoolean()) {
          edges.add(
              new Edge(from, to, random.nextInt(7) == 0 ? Integer.MAX_VALUE : random.nextInt(26)));
        }
      }
    }
    return List.copyOf(edges);
  }

  private static long[][] oracle(int nodes, List<Edge> edges) {
    var costs = new long[nodes][nodes];
    for (var node = 0; node < nodes; node++) {
      Arrays.fill(costs[node], Long.MAX_VALUE / 4);
      costs[node][node] = 0;
    }
    for (var edge : edges)
      costs[edge.from()][edge.to()] = Math.min(costs[edge.from()][edge.to()], edge.damage());
    for (var via = 0; via < nodes; via++) {
      for (var from = 0; from < nodes; from++) {
        for (var to = 0; to < nodes; to++)
          costs[from][to] = Math.min(costs[from][to], costs[from][via] + costs[via][to]);
      }
    }
    return costs;
  }
}
