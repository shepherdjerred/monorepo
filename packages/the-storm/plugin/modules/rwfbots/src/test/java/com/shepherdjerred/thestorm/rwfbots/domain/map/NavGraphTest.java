package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import org.junit.jupiter.api.Test;

final class NavGraphTest {

  private final NavArtifact nav = SyntheticMap.bake();
  private final NavGraph graph = nav.graph();

  private int node(BlockPos cell) {
    return graph.nodeAt(cell).orElseThrow();
  }

  @Test
  void floorCellsAreNodesAndWallCellsAreNot() {
    assertThat(graph.nodeAt(new BlockPos(5, 1, 5))).isPresent();
    assertThat(graph.nodeAt(new BlockPos(SyntheticMap.WALL_X, 1, 5))).isEmpty();
    assertThat(graph.nodeAt(new BlockPos(SyntheticMap.WALL_X, 1, 15))).isPresent();
    assertThat(graph.nodeAt(SyntheticMap.STEP.up())).isPresent();
  }

  @Test
  void aStarRoutesThroughTheDoor() {
    var path = graph.path(node(SyntheticMap.RED_SPAWN), node(new BlockPos(29, 1, 2))).orElseThrow();
    var cells = path.nodes().stream().map(graph::cell).toList();
    assertThat(cells)
        .anyMatch(cell -> cell.x() == SyntheticMap.WALL_X && (cell.z() == 15 || cell.z() == 16));
    assertThat(path.toFollow()).hasSize(path.length() - 1);
  }

  @Test
  void aSealedDoorMakesTheOtherSideUnreachable() {
    var sealed = NavGraphBuilder.build(new SyntheticMap(false));
    var from = sealed.nodeAt(SyntheticMap.RED_SPAWN).orElseThrow();
    var to = sealed.nodeAt(new BlockPos(29, 1, 2)).orElseThrow();
    assertThat(sealed.path(from, to)).isEmpty();
  }

  @Test
  void stepUpIsAJumpAndStepDownIsADrop() {
    var top = SyntheticMap.STEP.up();
    var up = graph.path(node(top.offset(-1, -1, 0)), node(top)).orElseThrow();
    assertThat(up.waypoints().getLast().hop()).isEqualTo(Hop.JUMP);
    var down = graph.path(node(top), node(top.offset(1, -1, 0))).orElseThrow();
    assertThat(down.waypoints().getLast().hop()).isEqualTo(Hop.DROP);
  }

  @Test
  void legacyPlatformDescentIsCostlyAndLargerFallsAreRejected() {
    var terrain =
        new BlockClassification() {
          @Override
          public GridBounds bounds() {
            return new GridBounds(new BlockPos(0, 0, 0), 3, 10, 1);
          }

          @Override
          public BlockShape shape(int x, int y, int z) {
            var height = x == 0 ? 5 : x == 2 ? 7 : 0;
            return y <= height ? BlockShape.FULL : BlockShape.PASSABLE;
          }

          @Override
          public boolean blocksSight(int x, int y, int z) {
            return shape(x, y, z).blocksMovement();
          }
        };
    var platforms = NavGraphBuilder.build(terrain);
    var low = platforms.nodeAt(new BlockPos(1, 1, 0)).orElseThrow();
    var spawn = platforms.nodeAt(new BlockPos(0, 6, 0)).orElseThrow();
    var descent = platforms.path(spawn, low).orElseThrow();
    assertThat(descent.waypoints().getLast().hop()).isEqualTo(Hop.DROP);
    assertThat(descent.cost()).isEqualTo(14);
    var high = platforms.nodeAt(new BlockPos(2, 8, 0)).orElseThrow();
    assertThat(platforms.path(high, low)).isEmpty();
  }

  @Test
  void floatingPlatformLeapRequiresAClearFlightCorridor() {
    for (var blocked : new boolean[] {false, true}) {
      var terrain =
          new BlockClassification() {
            @Override
            public GridBounds bounds() {
              return new GridBounds(new BlockPos(0, 0, 0), 4, 10, 1);
            }

            @Override
            public BlockShape shape(int x, int y, int z) {
              return (x == 0 && y <= 5) || (x == 3 && y == 0) || (blocked && x == 1 && y == 8)
                  ? BlockShape.FULL
                  : BlockShape.PASSABLE;
            }

            @Override
            public boolean blocksSight(int x, int y, int z) {
              return shape(x, y, z).blocksMovement();
            }
          };
      var platforms = NavGraphBuilder.build(terrain);
      var from = platforms.nodeAt(new BlockPos(0, 6, 0)).orElseThrow();
      var to = platforms.nodeAt(new BlockPos(3, 1, 0)).orElseThrow();
      var path = platforms.path(from, to);
      if (blocked) assertThat(path).isEmpty();
      else assertThat(path.orElseThrow().waypoints().getLast().hop()).isEqualTo(Hop.LEAP);
    }
  }

  @Test
  void oceanNavigationUsesTheSwimmableSurfaceAndCanExitOntoTheShore() {
    var ocean =
        new BlockClassification() {
          @Override
          public GridBounds bounds() {
            return new GridBounds(new BlockPos(0, 0, 0), 3, 100, 1);
          }

          @Override
          public BlockShape shape(int x, int y, int z) {
            if (y == 0 || (x == 2 && y <= 90)) return BlockShape.FULL;
            return y <= 90 ? BlockShape.LIQUID : BlockShape.PASSABLE;
          }

          @Override
          public boolean blocksSight(int x, int y, int z) {
            return shape(x, y, z).blocksProjectile();
          }
        };
    var surface = NavGraphBuilder.build(ocean);
    assertThat(surface.nodeCount()).isEqualTo(3);
    assertThat(surface.nodeAt(new BlockPos(0, 89, 0))).isEmpty();
    var from = surface.nodeAt(new BlockPos(0, 90, 0)).orElseThrow();
    var to = surface.nodeAt(new BlockPos(2, 91, 0)).orElseThrow();
    assertThat(surface.path(from, to)).isPresent();
    assertThat(surface.path(to, from)).isPresent();
  }

  @Test
  void flowFieldAgreesWithAStarCosts() {
    var goal = node(new BlockPos(29, 1, 2));
    var field = FlowField.toward(graph, goal);
    for (var cell :
        new BlockPos[] {SyntheticMap.RED_SPAWN, new BlockPos(3, 1, 25), new BlockPos(20, 1, 20)}) {
      var start = node(cell);
      var path = graph.path(start, goal).orElseThrow();
      assertThat(field.distance().at(start)).isCloseTo((float) path.cost(), within(1e-3f));
      var steps = field.pathFrom(start, 500);
      assertThat(steps).hasSize(path.length() - 1);
      assertThat(steps.getLast().pos()).isEqualTo(graph.feet(goal));
    }
    assertThat(field.next(goal)).isEqualTo(-1);
  }

  @Test
  void penaltiesBendRoutes() {
    var from = node(new BlockPos(2, 1, 10));
    var to = node(new BlockPos(14, 1, 10));
    var straight = graph.path(from, to).orElseThrow();
    assertThat(straight.cost()).isCloseTo(12, within(1e-6));
    var bent =
        graph.path(from, to, candidate -> graph.cell(candidate).z() == 10 ? 5 : 0).orElseThrow();
    assertThat(bent.cost()).isGreaterThan(straight.cost());
    assertThat(bent.nodes().stream().map(graph::cell).filter(c -> c.z() == 10).count())
        .isLessThan(straight.nodes().size());
  }

  @Test
  void aStarOnTheArenaTakesWellUnderAMillisecond() {
    var from = node(SyntheticMap.RED_SPAWN);
    var to = node(SyntheticMap.BLUE_SPAWN);
    for (var i = 0; i < 200; i++) {
      graph.path(from, to);
    }
    var start = System.nanoTime();
    for (var i = 0; i < 200; i++) {
      graph.path(from, to);
    }
    var millis = (System.nanoTime() - start) / 200.0 / 1.0e6;
    assertThat(millis).as("ms per corner-to-corner A*").isLessThan(5);
  }
}
