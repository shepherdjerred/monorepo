package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.LeverCurves;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockClassification;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockShape;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.HealthRoutes;
import com.shepherdjerred.thestorm.rwfbots.domain.map.MapBaker;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavSites;
import com.shepherdjerred.thestorm.rwfbots.domain.map.TraversalDensity;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class RouteNavigatorTest {
  private record WaterStep() implements BlockClassification {
    @Override
    public GridBounds bounds() {
      return new GridBounds(new BlockPos(0, 96, 0), 7, 8, 3);
    }

    @Override
    public BlockShape shape(int x, int y, int z) {
      var floor = x < 3 ? 98 : 99;
      if (y <= floor) return BlockShape.FULL;
      return y == floor + 1 ? BlockShape.LIQUID : BlockShape.PASSABLE;
    }

    @Override
    public boolean blocksSight(int x, int y, int z) {
      return shape(x, y, z).blocksMovement();
    }
  }

  @Test
  void adjacentNonOverlappingWaterIntervalsKeepTheirCertifiedInterfaceInBothDirections() {
    var nav = MapBaker.bake("water-step", new WaterStep(), new NavSites(List.of(), List.of()));
    var graph = nav.graph();
    var context =
        new TacticsContext(
            nav,
            LeverCurves.at(1),
            new Style(0.5, 0.5, 0.5, 0.5),
            Kit.TROOPER,
            Archetype.DUELIST,
            Set.of(),
            196,
            graph.workspace());
    var edges =
        new HealthRoutes.EdgePolicy(
            edge -> 0, new NavGraph.EdgeMotion(graph::edgeCost, edge -> true, 1));
    var risk =
        new TraversalRisk.Query(
            new HealthRoutes.RiskPolicy(19, 0),
            edges,
            node -> 0,
            false,
            new TraversalRisk.Source(
                com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant(
                    1, com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED, graph.feet(0)),
                0));
    var low = new Vec3(1.5, 99, 1.5);
    var high = new Vec3(5.5, 100, 1.5);
    for (var endpoints :
        List.of(
            new com.shepherdjerred.thestorm.rwfbots.domain.map.WaterRoutes.Endpoints(low, high),
            new com.shepherdjerred.thestorm.rwfbots.domain.map.WaterRoutes.Endpoints(high, low))) {
      var found =
          RouteNavigator.find(
              context,
              new RouteNavigator.Endpoints(
                  graph.nearestNode(endpoints.from()).orElseThrow(),
                  graph.nearestNode(endpoints.to()).orElseThrow(),
                  endpoints.from(),
                  endpoints.to()),
              new RouteNavigator.Tolls(risk, node -> 0));
      assertThat(found).isNotEmpty();
      assertThat(found.getLast().pos()).isEqualTo(endpoints.to());
      assertThat(found)
          .allMatch(
              point -> point.hop() == com.shepherdjerred.thestorm.rwfbots.domain.world.Hop.SWIM);
      var zero =
          RouteNavigator.score(
                  context, endpoints.from(), found, new RouteNavigator.Tolls(risk, node -> 0))
              .orElseThrow();
      var exposed =
          RouteNavigator.score(
                  context, endpoints.from(), found, new RouteNavigator.Tolls(risk, node -> 12))
              .orElseThrow();
      assertThat(exposed.ticks()).isEqualTo(zero.ticks());
      assertThat(exposed.cost())
          .isCloseTo(zero.cost() + TraversalDensity.cost(12, 12, zero.ticks()), within(1e-10));
    }
  }

  private record HighPool() implements BlockClassification {
    @Override
    public GridBounds bounds() {
      return new GridBounds(new BlockPos(0, 0, 0), 5, 11, 3);
    }

    @Override
    public BlockShape shape(int x, int y, int z) {
      if (y == 0 || (x == 3 && y <= 7)) return BlockShape.FULL;
      return x <= 2 && y <= 8 ? BlockShape.LIQUID : BlockShape.PASSABLE;
    }

    @Override
    public boolean blocksSight(int x, int y, int z) {
      return shape(x, y, z).blocksMovement();
    }
  }

  @Test
  void virtualSourceDepthCannotOvercreditProtectionThatExpiresBeforeTheActualDrop() {
    var nav = MapBaker.bake("pool", new HighPool(), new NavSites(List.of(), List.of()));
    var graph = nav.graph();
    var source = new Vec3(2.5, 5.1, 1.5);
    var goal = new Vec3(4.5, 1, 1.5);
    var from = graph.nearestNode(source).orElseThrow();
    var to = graph.nearestNode(goal).orElseThrow();
    assertThat(graph.feet(from).y()).isEqualTo(7);
    var policy = new HealthRoutes.RiskPolicy(0, 0);
    var edges =
        HealthRoutes.EdgePolicy.timed(
            (edge, elapsed) -> elapsed < 30 ? 0 : graph.edgeDamage(edge),
            new NavGraph.EdgeMotion(graph::edgeCost, edge -> true, 1));
    assertThat(
            HealthRoutes.find(
                graph, new HealthRoutes.Request(from, to, policy, node -> 0), edges, null))
        .isPresent();
    var context =
        new TacticsContext(
            nav,
            LeverCurves.at(1),
            new Style(0.5, 0.5, 0.5, 0.5),
            Kit.TROOPER,
            Archetype.DUELIST,
            Set.of(),
            196,
            graph.workspace());
    var risk =
        new TraversalRisk.Query(
            policy,
            edges,
            node -> 0,
            false,
            new TraversalRisk.Source(
                com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant(
                    1, com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED, source),
                0));
    assertThat(
            RouteNavigator.find(
                context,
                new RouteNavigator.Endpoints(from, to, source, goal),
                new RouteNavigator.Tolls(risk, node -> 0)))
        .isEmpty();
  }
}
