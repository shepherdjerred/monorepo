package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.map.StairQuarters.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.map.StairQuarters.Shape;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import java.util.List;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

/** Half steps are walked up as vanilla walks them; a full block is still jumped. */
final class StairWalkUpTest {
  private static final int NE_SE = StairQuarters.NORTH_EAST | StairQuarters.SOUTH_EAST;

  // Floor at y 0. At x 2, z 1, a stair whose tall half is its east half (facing east); at x 2,
  // z 3, a bottom slab; at x 2, z 5, a full block.
  private static final BlockClassification TERRAIN =
      new BlockClassification() {
        @Override
        public GridBounds bounds() {
          return new GridBounds(new BlockPos(0, 0, 0), 5, 5, 7);
        }

        @Override
        public BlockShape shape(int x, int y, int z) {
          if (y == 0) return BlockShape.FULL;
          if (x == 2 && y == 1 && z == 1) return BlockShape.STAIRS;
          if (x == 2 && y == 1 && z == 3) return BlockShape.SLAB_BOTTOM;
          if (x == 2 && y == 1 && z == 5) return BlockShape.FULL;
          return BlockShape.PASSABLE;
        }

        @Override
        public boolean blocksSight(int x, int y, int z) {
          return shape(x, y, z).blocksMovement();
        }

        @Override
        public int halfStepQuarters(int x, int y, int z) {
          return shape(x, y, z) == BlockShape.STAIRS
              ? StairQuarters.halfStep(Facing.EAST, Shape.STRAIGHT)
              : 0;
        }
      };

  private static final NavGraph GRAPH = NavGraphBuilder.build(TERRAIN);

  // A stair at x 2, z 1 with its tall half east; bottom slabs on full blocks east of it (x 3) and
  // north of it (z 0), their tops half a block above the stair's.
  private static final BlockClassification TURN =
      new BlockClassification() {
        @Override
        public GridBounds bounds() {
          return new GridBounds(new BlockPos(0, 0, 0), 5, 5, 3);
        }

        @Override
        public BlockShape shape(int x, int y, int z) {
          if (y == 0) return BlockShape.FULL;
          if (x == 2 && y == 1 && z == 1) return BlockShape.STAIRS;
          var landing = (x == 3 && z == 1) || (x == 2 && z == 0);
          if (landing && y == 1) return BlockShape.FULL;
          return landing && y == 2 ? BlockShape.SLAB_BOTTOM : BlockShape.PASSABLE;
        }

        @Override
        public boolean blocksSight(int x, int y, int z) {
          return shape(x, y, z).blocksMovement();
        }

        @Override
        public int halfStepQuarters(int x, int y, int z) {
          return shape(x, y, z) == BlockShape.STAIRS
              ? StairQuarters.halfStep(Facing.EAST, Shape.STRAIGHT)
              : 0;
        }
      };

  private static List<Hop> hops(BlockPos from, BlockPos to) {
    var source = GRAPH.nodeAt(from).orElseThrow();
    var target = GRAPH.nodeAt(to).orElseThrow();
    return IntStream.range(GRAPH.edgeStart(source), GRAPH.edgeEnd(source))
        .filter(edge -> GRAPH.edgeTarget(edge) == target)
        .mapToObj(GRAPH::edgeHop)
        .toList();
  }

  @Test
  void aStairEnteredByItsLowerHalfIsWalkedUp() {
    assertThat(hops(new BlockPos(1, 1, 1), new BlockPos(2, 2, 1))).containsExactly(Hop.WALK);
  }

  @Test
  void aStairEnteredByItsTallBackOrSideIsStillJumped() {
    assertThat(hops(new BlockPos(3, 1, 1), new BlockPos(2, 2, 1))).containsExactly(Hop.JUMP);
    assertThat(hops(new BlockPos(2, 1, 0), new BlockPos(2, 2, 1))).containsExactly(Hop.JUMP);
    assertThat(hops(new BlockPos(1, 1, 0), new BlockPos(2, 2, 1))).containsExactly(Hop.JUMP);
  }

  @Test
  void aBottomSlabIsWalkedUpFromAnySide() {
    assertThat(hops(new BlockPos(1, 1, 3), new BlockPos(2, 2, 3))).containsExactly(Hop.WALK);
    assertThat(hops(new BlockPos(3, 1, 3), new BlockPos(2, 2, 3))).containsExactly(Hop.WALK);
    assertThat(hops(new BlockPos(1, 1, 4), new BlockPos(2, 2, 3))).containsExactly(Hop.WALK);
  }

  @Test
  void aBodyOnAStairWalksUpOnlyAcrossItsTallHalf() {
    // hemispheres: a body on the lower half of a tower stair is half a block below its node, so
    // turning off the stair sideways onto a slab is a block's rise for it, not a half step.
    var graph = NavGraphBuilder.build(TURN);
    var stair = graph.nodeAt(new BlockPos(2, 2, 1)).orElseThrow();
    var east = graph.nodeAt(new BlockPos(3, 3, 1)).orElseThrow();
    var north = graph.nodeAt(new BlockPos(2, 3, 0)).orElseThrow();
    assertThat(hopsTo(graph, stair, east)).containsExactly(Hop.WALK);
    assertThat(hopsTo(graph, stair, north)).containsExactly(Hop.JUMP);
  }

  private static List<Hop> hopsTo(NavGraph graph, int source, int target) {
    return IntStream.range(graph.edgeStart(source), graph.edgeEnd(source))
        .filter(edge -> graph.edgeTarget(edge) == target)
        .mapToObj(graph::edgeHop)
        .toList();
  }

  @Test
  void aFullBlockIsJumped() {
    assertThat(hops(new BlockPos(1, 1, 5), new BlockPos(2, 2, 5))).containsExactly(Hop.JUMP);
  }

  @Test
  void stairQuartersMatchVanillaShapes() {
    var back = StairQuarters.NORTH_WEST | StairQuarters.NORTH_EAST;
    assertThat(StairQuarters.halfStep(Facing.NORTH, Shape.STRAIGHT))
        .isEqualTo(StairQuarters.ALL & ~back);
    assertThat(StairQuarters.halfStep(Facing.NORTH, Shape.OUTER_LEFT))
        .isEqualTo(StairQuarters.ALL & ~StairQuarters.NORTH_WEST);
    assertThat(StairQuarters.halfStep(Facing.NORTH, Shape.OUTER_RIGHT))
        .isEqualTo(StairQuarters.ALL & ~StairQuarters.NORTH_EAST);
    assertThat(StairQuarters.halfStep(Facing.NORTH, Shape.INNER_LEFT))
        .isEqualTo(StairQuarters.SOUTH_EAST);
    assertThat(StairQuarters.halfStep(Facing.NORTH, Shape.INNER_RIGHT))
        .isEqualTo(StairQuarters.SOUTH_WEST);
    assertThat(StairQuarters.halfStep(Facing.SOUTH, Shape.OUTER_LEFT))
        .isEqualTo(StairQuarters.ALL & ~StairQuarters.SOUTH_EAST);
    assertThat(StairQuarters.halfStep(Facing.EAST, Shape.STRAIGHT))
        .isEqualTo(StairQuarters.ALL & ~NE_SE);
    assertThat(StairQuarters.entered(1, 0))
        .isEqualTo(StairQuarters.NORTH_WEST | StairQuarters.SOUTH_WEST);
    assertThat(StairQuarters.entered(1, 1)).isZero();
  }
}
