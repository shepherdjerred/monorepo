package com.shepherdjerred.thestorm.rwfbots.domain.perception;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.map.Regions;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.map.WaterIndex;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.BitSet;
import java.util.List;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

final class WaterPerceptionTest {
  private static final GridBounds BOUNDS = new GridBounds(new BlockPos(0, 0, 0), 2, 10, 1);

  private static NavGraph graph() {
    var water =
        new WaterIndex(
            BOUNDS,
            new int[] {0, 1, 2},
            new WaterIndex.Intervals(new int[] {1, 1}, new int[] {8, 8}, new int[] {0, 2, 4}),
            new WaterIndex.Portals(new int[] {0, 1, 2, 3}, new int[] {1, 8, 1, 8}));
    var nodes =
        new NavGraph.NodeData(
            new int[] {
              BOUNDS.index(0, 1, 0),
              BOUNDS.index(0, 8, 0),
              BOUNDS.index(1, 1, 0),
              BOUNDS.index(1, 8, 0)
            },
            water);
    return new NavGraph(
        BOUNDS,
        nodes,
        new NavGraph.Topology(new int[] {0, 0, 0, 0, 0}, new int[0]),
        new NavGraph.EdgeData(new byte[0], new float[0]));
  }

  @Test
  void submergedTargetsUseActualSightRaysRatherThanDistantPortalRegions() {
    var graph = graph();
    var regions =
        new Regions(new int[] {0, 0, 1, 1}, List.of(graph.feet(0), graph.feet(2)), new BitSet());
    var self = Fixtures.combatant(1, Fixtures.RED, new Vec3(.5, 4, .5));
    var enemy = Fixtures.combatant(2, Fixtures.BLUE, new Vec3(1.5, 4, .5));
    var world =
        new WorldSnapshot(
            1,
            MatchPhase.LIVE,
            List.of(self, enemy),
            List.of(),
            PoisonView.NONE,
            "deep-water",
            List.of(),
            List.of());
    assertThat(regions.canSee(0, 1)).isFalse();
    var empty = new BitSet();
    var open = new VoxelGrid(BOUNDS, empty, empty, empty);
    var perception = new Perception(new SenseContext(open, graph, regions, Fixtures.levers(1)));
    assertThat(
            perception
                .perceive(PerceptionState.EMPTY, self, world, new SplittableRandom(1))
                .sees(enemy.id()))
        .isTrue();
    var wall = new BitSet();
    for (var y = 0; y < BOUNDS.sizeY(); y++) wall.set(BOUNDS.index(1, y, 0));
    var blocked = new VoxelGrid(BOUNDS, wall, wall, wall);
    var occluded = new Perception(new SenseContext(blocked, graph, regions, Fixtures.levers(1)));
    assertThat(
            occluded
                .perceive(PerceptionState.EMPTY, self, world, new SplittableRandom(1))
                .sees(enemy.id()))
        .isFalse();
  }
}
