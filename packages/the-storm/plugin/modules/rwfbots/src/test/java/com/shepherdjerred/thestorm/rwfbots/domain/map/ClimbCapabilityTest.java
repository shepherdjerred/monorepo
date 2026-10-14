package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import java.util.BitSet;
import org.junit.jupiter.api.Test;

final class ClimbCapabilityTest {
  @Test
  void exactClimbCapabilitiesAreDefensiveAndBoundedByNodes() {
    var bounds = new GridBounds(new BlockPos(0, 0, 0), 2, 2, 2);
    var bits = new BitSet();
    bits.set(1);
    var nodes =
        new NavGraph.NodeData(new int[] {0, 1}, WaterIndex.empty(bounds), new byte[2], bits);
    bits.clear();
    assertThat(nodes.climbable().get(1)).isTrue();
    var copy = nodes.climbable();
    copy.clear();
    assertThat(nodes.climbable().get(1)).isTrue();
    var graph =
        new NavGraph(
            bounds,
            nodes,
            new NavGraph.Topology(new int[3], new int[0]),
            new NavGraph.EdgeData(new byte[0], new float[0]));
    assertThat(graph.climbable(0)).isFalse();
    assertThat(graph.climbable(1)).isTrue();
    graph.climbableNodes().clear();
    assertThat(graph.climbable(1)).isTrue();
    assertThatThrownBy(() -> graph.climbable(2)).isInstanceOf(IllegalArgumentException.class);
    bits.set(2);
    assertThatThrownBy(
            () ->
                new NavGraph.NodeData(
                    new int[] {0, 1}, WaterIndex.empty(bounds), new byte[2], bits))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
