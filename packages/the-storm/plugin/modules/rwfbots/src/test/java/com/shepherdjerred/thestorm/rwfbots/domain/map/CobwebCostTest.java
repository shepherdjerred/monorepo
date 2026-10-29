package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import org.junit.jupiter.api.Test;

/** A cobweb is passable but slow: steps into, out of and through one cost what they take. */
final class CobwebCostTest {

  // Floor at y 0 and a corridor two wide along x at z 1 and 2, walled to y 5. A cobweb hangs at
  // head height at x 3 of its z 1 side. A pillar at x 4, z 5 rises to a ledge at y 6 beside a shaft
  // at x 5, z 5 down to the floor, with a cobweb in it at y 3.
  private static final BlockClassification TERRAIN =
      new BlockClassification() {
        @Override
        public GridBounds bounds() {
          return new GridBounds(new BlockPos(0, 0, 0), 7, 8, 7);
        }

        @Override
        public BlockShape shape(int x, int y, int z) {
          if (y == 0 || (x == 4 && z == 5 && y <= 5)) return BlockShape.FULL;
          var open = z == 1 || z == 2 || (x == 5 && z == 5) || y >= 6;
          return open ? BlockShape.PASSABLE : BlockShape.FULL;
        }

        @Override
        public boolean blocksSight(int x, int y, int z) {
          return shape(x, y, z).blocksMovement();
        }

        @Override
        public boolean slowsMovement(int x, int y, int z) {
          return (x == 3 && y == 2 && z == 1) || (x == 5 && y == 3 && z == 5);
        }
      };

  private static final NavGraph GRAPH = NavGraphBuilder.build(TERRAIN);

  private static int edge(BlockPos from, BlockPos to, Hop hop) {
    var source = GRAPH.nodeAt(from).orElseThrow();
    var target = GRAPH.nodeAt(to).orElseThrow();
    for (var edge = GRAPH.edgeStart(source); edge < GRAPH.edgeEnd(source); edge++)
      if (GRAPH.edgeTarget(edge) == target && GRAPH.edgeHop(edge) == hop) return edge;
    throw new AssertionError("no " + hop + " from " + from + " to " + to);
  }

  @Test
  void stepsIntoAndOutOfACobwebCostWhatTheyTake() {
    var into = edge(new BlockPos(2, 1, 1), new BlockPos(3, 1, 1), Hop.WALK);
    var out = edge(new BlockPos(3, 1, 1), new BlockPos(4, 1, 1), Hop.WALK);
    var clear = edge(new BlockPos(1, 1, 1), new BlockPos(2, 1, 1), Hop.WALK);
    assertThat(GRAPH.edgeCost(clear)).isEqualTo(NavGraph.WALK_COST);
    assertThat(GRAPH.edgeCost(into))
        .isEqualTo(NavGraph.WALK_COST * NavGraphBuilder.COBWEB_SLOWDOWN);
    assertThat(GRAPH.edgeCost(out)).isEqualTo(NavGraph.WALK_COST * NavGraphBuilder.COBWEB_SLOWDOWN);
  }

  @Test
  void aDropThroughACobwebIsSlow() {
    var drop = edge(new BlockPos(4, 6, 5), new BlockPos(5, 1, 5), Hop.DROP);
    assertThat(GRAPH.edgeCost(drop))
        .isEqualTo(TraversalCosts.drop(5) * NavGraphBuilder.COBWEB_SLOWDOWN);
  }

  @Test
  void aRouteWalksAroundACobwebWhenTheWayRoundIsShort() {
    var path =
        GRAPH
            .path(
                GRAPH.nodeAt(new BlockPos(1, 1, 1)).orElseThrow(),
                GRAPH.nodeAt(new BlockPos(5, 1, 1)).orElseThrow())
            .orElseThrow();
    assertThat(path.nodes())
        .as("along the corridor's clear side")
        .doesNotContain(GRAPH.nodeAt(new BlockPos(3, 1, 1)).orElseThrow());
  }
}
