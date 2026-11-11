package com.shepherdjerred.thestorm.rwfbots.domain.team;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * A side hall closer than a lane gap, and a tunnel under the main hall, stay their own lanes. A
 * straight hall grows none.
 */
final class PassageLanesTest {

  @Test
  void aSideHallCloserThanTheLaneGapStaysACut() {
    var lanes = lanes(passage(true, false));
    assertThat(lanes).anyMatch(Lane::cut);
    assertThat(lanes.stream().filter(Lane::cut))
        .allSatisfy(cut -> assertThat(Math.abs(cut.lateral())).isLessThan(Lanes.MIN_GAP));
    assertCutsAreLast(lanes);
    assertThat(lanes.get(Lanes.pick(lanes, Lanes.Which.LEFT)).cut()).isFalse();
    assertThat(lanes.get(Lanes.pick(lanes, Lanes.Which.RIGHT)).cut()).isFalse();
  }

  @Test
  void anUndergroundHallBecomesACutBelowTheMainLane() {
    var lanes = lanes(passage(false, true));
    var cut = lanes.stream().filter(Lane::cut).findFirst().orElseThrow();
    var main = lanes.stream().filter(lane -> !lane.cut()).findFirst().orElseThrow();
    assertThat(meanY(main) - meanY(cut)).isGreaterThanOrEqualTo(3);
    assertCutsAreLast(lanes);
  }

  @Test
  void aStraightHallGrowsNoCut() {
    var lanes = lanes(passage(false, false));
    assertThat(lanes).isNotEmpty();
    assertThat(lanes).noneMatch(Lane::cut);
  }

  private static void assertCutsAreLast(List<Lane> lanes) {
    var seen = false;
    for (var lane : lanes) {
      if (lane.cut()) {
        seen = true;
      } else {
        assertThat(seen).isFalse();
      }
    }
  }

  private static double meanY(Lane lane) {
    return lane.points().stream().mapToDouble(Vec3::y).average().orElseThrow();
  }

  private static List<Lane> lanes(NavGraph graph) {
    return Lanes.toward(graph, graph.feet(0), graph.feet(20), List.of());
  }

  /**
   * Twenty-one nodes along {@code y=10}, plus a parallel hall when {@code side} or {@code under}.
   * The parallel hall joins only at the ends, four blocks off, so it is shorter than one and a half
   * times the main hall and shares none of its interior.
   */
  private static NavGraph passage(boolean side, boolean under) {
    var parallel = side || under;
    var nodes = parallel ? 42 : 21;
    var bounds = new GridBounds(new BlockPos(0, 0, 0), 21, 12, 6);
    var cells = new int[nodes];
    for (var x = 0; x <= 20; x++) {
      cells[x] = bounds.index(x, 10, 0);
    }
    if (parallel) {
      var y = under ? 6 : 10;
      var z = side ? 4 : 0;
      for (var x = 0; x <= 20; x++) {
        cells[21 + x] = bounds.index(x, y, z);
      }
    }
    var adjacent = new ArrayList<List<Integer>>();
    for (var node = 0; node < nodes; node++) {
      adjacent.add(new ArrayList<>());
    }
    for (var x = 0; x < 20; x++) {
      join(adjacent, x, x + 1);
      if (parallel) {
        join(adjacent, 21 + x, 22 + x);
      }
    }
    if (parallel) {
      join(adjacent, 0, 21);
      join(adjacent, 20, 41);
    }
    var edgeTo = new ArrayList<Integer>();
    var edgeStart = new int[nodes + 1];
    for (var node = 0; node < nodes; node++) {
      edgeStart[node] = edgeTo.size();
      edgeTo.addAll(adjacent.get(node));
    }
    edgeStart[nodes] = edgeTo.size();
    var targets = edgeTo.stream().mapToInt(Integer::intValue).toArray();
    var hop = new byte[targets.length];
    var cost = new float[targets.length];
    Arrays.fill(hop, Hop.WALK.code());
    Arrays.fill(cost, 1f);
    return new NavGraph(
        bounds, cells, new NavGraph.Topology(edgeStart, targets), new NavGraph.EdgeData(hop, cost));
  }

  private static void join(List<List<Integer>> adjacent, int left, int right) {
    adjacent.get(left).add(right);
    adjacent.get(right).add(left);
  }
}
