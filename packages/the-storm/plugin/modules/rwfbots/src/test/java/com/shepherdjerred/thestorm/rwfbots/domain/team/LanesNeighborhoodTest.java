package com.shepherdjerred.thestorm.rwfbots.domain.team;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.TrainingYardNav;
import java.util.List;
import org.junit.jupiter.api.Test;

final class LanesNeighborhoodTest {
  @Test
  void longTraversalEdgesDoNotExpandALocalLaneButActualRouteLandingsRemainIncluded() {
    var graph = TrainingYardNav.NAV.graph();
    var from = graph.nearestNodeWithin(new Vec3(20.5, 65, 31.5), 2).orElseThrow();
    var far = -1;
    for (var edge = graph.edgeStart(from); edge < graph.edgeEnd(from); edge++) {
      var target = graph.edgeTarget(edge);
      if (graph.feet(from).horizontalDistance(graph.feet(target)) > 3) far = target;
    }
    assertThat(far).as("baked long traversal edge").isNotNegative();
    var origin = graph.feet(from);
    var corridor = Lanes.corridor(graph, List.of(from));
    assertThat(corridor).doesNotContain(far);
    for (var node : corridor) {
      var feet = graph.feet(node);
      assertThat(Math.abs(feet.x() - origin.x())).isLessThanOrEqualTo(2);
      assertThat(Math.abs(feet.z() - origin.z())).isLessThanOrEqualTo(2);
    }
    assertThat(Lanes.corridor(graph, List.of(from, far))).contains(from, far);
  }
}
