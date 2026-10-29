package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import java.util.List;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

/**
 * Jump edges climb the rise between actual feet heights: a bottom slab lowers the take-off by half
 * a block, and a block and a half is more than an unboosted jump's apex.
 */
final class JumpRiseTest {
  // Floor at y 0; a bottom slab row at x 2 and a two-high wall at x 3, its top at y 3; a ladder in
  // the slab row's z 0 cell; ordinary floor east of the wall at x 4, a block up.
  private static final BlockClassification TERRAIN =
      new BlockClassification() {
        @Override
        public GridBounds bounds() {
          return new GridBounds(new BlockPos(0, 0, 0), 6, 7, 3);
        }

        @Override
        public BlockShape shape(int x, int y, int z) {
          if (y == 0) return BlockShape.FULL;
          if (x == 2 && y == 1) return BlockShape.SLAB_BOTTOM;
          if (x == 2 && y == 2 && z == 0) return BlockShape.LADDER;
          if (x == 3 && y <= 2) return BlockShape.FULL;
          if (x == 4 && y == 1) return BlockShape.FULL;
          return BlockShape.PASSABLE;
        }

        @Override
        public boolean blocksSight(int x, int y, int z) {
          return shape(x, y, z).blocksMovement();
        }
      };

  private static final NavGraph GRAPH = NavGraphBuilder.build(TERRAIN);

  private static List<Hop> hops(BlockPos from, BlockPos to) {
    var source = GRAPH.nodeAt(from).orElseThrow();
    var target = GRAPH.nodeAt(to).orElseThrow();
    return IntStream.range(GRAPH.edgeStart(source), GRAPH.edgeEnd(source))
        .filter(edge -> GRAPH.edgeTarget(edge) == target)
        .mapToObj(GRAPH::edgeHop)
        .toList();
  }

  @Test
  void aBodyOnABottomSlabGetsNoJumpOntoTheFullBlockABlockAndAHalfAboveIt() {
    assertThat(GRAPH.feet(GRAPH.nodeAt(new BlockPos(2, 2, 1)).orElseThrow()).y()).isEqualTo(1.5);
    assertThat(hops(new BlockPos(2, 2, 1), new BlockPos(3, 3, 1))).isEmpty();
  }

  @Test
  void aBlockHighLedgeIsStillAJump() {
    assertThat(hops(new BlockPos(4, 2, 1), new BlockPos(3, 3, 1))).containsExactly(Hop.JUMP);
  }

  @Test
  void aBodyHoldingALadderClimbsTheRestOfTheWay() {
    assertThat(hops(new BlockPos(2, 2, 0), new BlockPos(3, 3, 0))).containsExactly(Hop.JUMP);
  }
}
