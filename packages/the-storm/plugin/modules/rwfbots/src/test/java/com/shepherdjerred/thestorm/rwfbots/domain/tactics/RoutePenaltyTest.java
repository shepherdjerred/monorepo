package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.TrainingYardNav;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** Per-bot route penalties on the shipped training yard. */
final class RoutePenaltyTest {

  private static final com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph GRAPH =
      TrainingYardNav.NAV.graph();

  private static final int FROM =
      GRAPH.nearestNodeWithin(new Vec3(20.5, 65, 31.5), 2).orElseThrow();
  private static final int TO = GRAPH.nearestNodeWithin(new Vec3(44.5, 65, 31.5), 2).orElseThrow();

  private static List<Integer> route(long seed, Set<Integer> occupied) {
    var penalty =
        RoutePenalty.of(GRAPH, seed, new RoutePenalty.Tolls(occupied, Optional.empty(), node -> 0));
    return GRAPH.path(FROM, TO, penalty).orElseThrow().nodes();
  }

  @Test
  void theSameBotTakesTheSameRouteAndDifferentBotsDiffer() {
    assertThat(route(7, Set.of())).isEqualTo(route(7, Set.of()));
    var distinct = new HashSet<List<Integer>>();
    for (var seed = 1L; seed <= 6; seed++) {
      distinct.add(route(seed, Set.of()));
    }
    assertThat(distinct).hasSizeGreaterThanOrEqualTo(3);
  }

  @Test
  void aTeammatesPathPushesTheRouteAside() {
    var first = route(3, Set.of());
    // Shared endpoints are unavoidable; trim physical distance, since one LEAP is many blocks.
    var occupied =
        first.stream()
            .filter(node -> GRAPH.feet(node).horizontalDistance(GRAPH.feet(FROM)) > 2)
            .filter(node -> GRAPH.feet(node).horizontalDistance(GRAPH.feet(TO)) > 2)
            .toList();
    var second = route(3, Set.copyOf(occupied));
    var shared = new HashSet<>(second);
    shared.retainAll(first);
    assertThat(shared.size()).isLessThan(first.size() / 2);
  }

  @Test
  void everyNodeRetainsTheExactDirectedNeighbourAndCorridorCosts() {
    var occupied = Set.copyOf(route(3, Set.of()));
    var corridor = Set.copyOf(route(7, Set.of()));
    var penalty =
        RoutePenalty.of(
            GRAPH, 9, new RoutePenalty.Tolls(occupied, Optional.of(corridor), n -> n % 3 * 0.1));
    for (var node = 0; node < GRAPH.nodeCount(); node++) {
      var near = occupied.contains(node);
      for (var edge = GRAPH.edgeStart(node); edge < GRAPH.edgeEnd(node); edge++) {
        var target = GRAPH.edgeTarget(edge);
        var a = GRAPH.feet(node);
        var b = GRAPH.feet(target);
        near |=
            occupied.contains(target)
                && Math.abs(a.x() - b.x()) <= 1
                && Math.abs(a.z() - b.z()) <= 1
                && Math.abs(a.y() - b.y()) <= 1.5;
      }
      var cell = GRAPH.cell(node);
      var expected =
          RoutePenalty.NOISE
              * RoutePenalty.noise(
                  9, cell.x() >> RoutePenalty.PATCH_SHIFT, cell.z() >> RoutePenalty.PATCH_SHIFT);
      if (near) expected += RoutePenalty.OCCUPIED;
      if (!corridor.contains(node)) expected += RoutePenalty.OFF_LANE;
      expected += node % 3 * 0.1;
      assertThat(penalty.applyAsDouble(node)).isEqualTo(expected);
    }
  }

  @Test
  void aDistantJumpDestinationDoesNotPretendItsTeammateIsBesideTheLaunch() {
    var distant = -1;
    var neighbor = -1;
    for (var edge = GRAPH.edgeStart(FROM); edge < GRAPH.edgeEnd(FROM); edge++) {
      var target = GRAPH.edgeTarget(edge);
      var distance = GRAPH.feet(FROM).horizontalDistance(GRAPH.feet(target));
      if (distance > 3) distant = target;
      if (distance <= 1 && distance > 0) neighbor = target;
    }
    assertThat(distant).as("baked long jump destination").isNotNegative();
    assertThat(neighbor).as("baked adjacent walk destination").isNotNegative();
    var base =
        RoutePenalty.of(GRAPH, 9, new RoutePenalty.Tolls(Set.of(), Optional.empty(), _ -> 0));
    var far =
        RoutePenalty.of(
            GRAPH, 9, new RoutePenalty.Tolls(Set.of(distant), Optional.empty(), _ -> 0));
    var close =
        RoutePenalty.of(
            GRAPH, 9, new RoutePenalty.Tolls(Set.of(neighbor), Optional.empty(), _ -> 0));
    assertThat(far.applyAsDouble(FROM)).isEqualTo(base.applyAsDouble(FROM));
    assertThat(close.applyAsDouble(FROM))
        .isEqualTo(base.applyAsDouble(FROM) + RoutePenalty.OCCUPIED);
  }

  @Test
  void leavingTheLaneCostsAndNoiseStaysBounded() {
    var corridor = Set.copyOf(route(3, Set.of()));
    var penalty =
        RoutePenalty.of(GRAPH, 3, new RoutePenalty.Tolls(Set.of(), Optional.of(corridor), n -> 0));
    var outside = GRAPH.nearestNodeWithin(new Vec3(32.5, 65, 10.5), 2).orElseThrow();
    assertThat(penalty.applyAsDouble(outside)).isGreaterThanOrEqualTo(RoutePenalty.OFF_LANE);
    for (var x = 0; x < 64; x += 3) {
      for (var z = 0; z < 64; z += 3) {
        assertThat(RoutePenalty.noise(9, x, z)).isBetween(0.0, 1.0);
      }
    }
  }
}
