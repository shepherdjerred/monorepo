package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import org.junit.jupiter.api.Test;

final class WaterNavigationTest {
  private record Pool(int depth, int barrierFloor) implements BlockClassification {
    @Override
    public GridBounds bounds() {
      return new GridBounds(new BlockPos(0, 0, 0), 7, depth + 3, 3);
    }

    @Override
    public BlockShape shape(int x, int y, int z) {
      if (y == 0 || (barrierFloor > 0 && x == 3 && y >= barrierFloor)) return BlockShape.FULL;
      return y <= depth ? BlockShape.LIQUID : BlockShape.PASSABLE;
    }

    @Override
    public boolean blocksSight(int x, int y, int z) {
      return shape(x, y, z).blocksMovement();
    }
  }

  @Test
  void depthDoesNotMultiplyTheRetainedGraphAndEveryInteriorDepthResolves() {
    var graph = NavGraphBuilder.build(new Pool(64, -1));
    assertThat(graph.nodeCount()).isEqualTo(7 * 3 * 2);
    for (var y = 1; y <= 64; y++) {
      var body = new Vec3(2.5, y, 1.5);
      assertThat(graph.nearestNode(body)).isPresent();
      assertThat(graph.water().contains(BlockPos.of(body))).isTrue();
    }
  }

  @Test
  void virtualMidDepthCrossingStaysLateralAndRetainsItsRealTravelTime() {
    var blocks = new Pool(16, -1);
    var graph = NavGraphBuilder.build(blocks);
    var from = new Vec3(1.5, 12.5, 1.5);
    var to = new Vec3(5.5, 12.5, 1.5);
    var route =
        WaterRoutes.find(
                graph.water(),
                VoxelGrid.from(blocks),
                new WaterRoutes.Endpoints(from, to),
                point -> 0)
            .orElseThrow();
    assertThat(route.waypoints()).allSatisfy(point -> assertThat(point.pos().y()).isEqualTo(12.5));
    assertThat(route.waypoints().getLast().pos()).isEqualTo(to);
    assertThat(route.ticks()).isCloseTo(4 / 0.215, within(1e-8));
  }

  @Test
  void aSubmergedOverlapForcesAnIntentionalDiveThenReturnsToTheGoalDepth() {
    var blocks = new Pool(16, 7);
    var graph = NavGraphBuilder.build(blocks);
    var from = new Vec3(1.5, 12, 1.5);
    var to = new Vec3(5.5, 12, 1.5);
    var route =
        WaterRoutes.find(
                graph.water(),
                VoxelGrid.from(blocks),
                new WaterRoutes.Endpoints(from, to),
                point -> 0)
            .orElseThrow();
    assertThat(route.waypoints())
        .anySatisfy(point -> assertThat(point.pos().y()).isLessThanOrEqualTo(5));
    assertThat(route.waypoints().getLast().pos()).isEqualTo(to);
    assertThat(route.ticks()).isGreaterThan(2 * 7 / 0.16);
  }

  @Test
  void aFractionalSurfaceSourceKeepsItsDepthWhenItsActualCapsuleHasHeadroom() {
    var blocks = new Pool(4, -1);
    var graph = NavGraphBuilder.build(blocks);
    var from = new Vec3(1.5, 4.32, 1.5);
    var to = new Vec3(5.5, 4.32, 1.5);
    var route =
        WaterRoutes.find(
                graph.water(),
                VoxelGrid.from(blocks),
                new WaterRoutes.Endpoints(from, to),
                point -> 0)
            .orElseThrow();
    assertThat(route.waypoints()).allSatisfy(point -> assertThat(point.pos().y()).isEqualTo(4.32));
  }

  @Test
  void fractionalDepthMustStillClearTheActualCeilingAboveAnIntegerPortal() {
    var pool = new Pool(4, -1);
    BlockClassification ceiling =
        new BlockClassification() {
          @Override
          public GridBounds bounds() {
            return pool.bounds();
          }

          @Override
          public BlockShape shape(int x, int y, int z) {
            return y == 6 ? BlockShape.FULL : pool.shape(x, y, z);
          }

          @Override
          public boolean blocksSight(int x, int y, int z) {
            return shape(x, y, z).blocksMovement();
          }
        };
    var graph = NavGraphBuilder.build(ceiling);
    var from = new Vec3(1.5, 4.32, 1.5);
    assertThat(graph.water().contains(BlockPos.of(from))).isTrue();
    assertThat(
            WaterRoutes.find(
                graph.water(),
                VoxelGrid.from(ceiling),
                new WaterRoutes.Endpoints(from, new Vec3(5.5, 4.32, 1.5)),
                point -> 0))
        .isEmpty();
  }

  @Test
  void aSealedFluidDividerDoesNotCreateAnUnderwaterShortcut() {
    var blocks = new Pool(16, 1);
    var graph = NavGraphBuilder.build(blocks);
    var route =
        WaterRoutes.find(
            graph.water(),
            VoxelGrid.from(blocks),
            new WaterRoutes.Endpoints(new Vec3(1.5, 12, 1.5), new Vec3(5.5, 12, 1.5)),
            point -> 0);
    assertThat(route).isEmpty();
  }

  @Test
  void leavingAHigherWaterColumnForDryGroundStillCarriesDirectedFallDamage() {
    var terrain =
        new BlockClassification() {
          @Override
          public GridBounds bounds() {
            return new GridBounds(new BlockPos(0, 0, 0), 2, 8, 1);
          }

          @Override
          public BlockShape shape(int x, int y, int z) {
            if (y == 0 || (x == 0 && y <= 4)) return BlockShape.FULL;
            return x == 0 && y <= 6 ? BlockShape.LIQUID : BlockShape.PASSABLE;
          }

          @Override
          public boolean blocksSight(int x, int y, int z) {
            return shape(x, y, z).blocksMovement();
          }
        };
    var graph = NavGraphBuilder.build(terrain);
    var from = graph.nodeAt(new BlockPos(0, 5, 0)).orElseThrow();
    var to = graph.nodeAt(new BlockPos(1, 1, 0)).orElseThrow();
    var edge =
        java.util.stream.IntStream.range(graph.edgeStart(from), graph.edgeEnd(from))
            .filter(candidate -> graph.edgeTarget(candidate) == to)
            .findFirst()
            .orElseThrow();
    assertThat(graph.edgeHop(edge)).isEqualTo(Hop.DROP);
    assertThat(graph.edgeDamage(edge)).isEqualTo(1);
  }
}
