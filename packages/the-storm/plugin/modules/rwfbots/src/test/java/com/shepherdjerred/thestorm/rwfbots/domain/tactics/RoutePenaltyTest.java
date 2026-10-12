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
    var second = route(3, Set.copyOf(first.subList(2, first.size() - 2)));
    var shared = new HashSet<>(second);
    shared.retainAll(first);
    assertThat(shared.size()).isLessThan(first.size() / 2);
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
