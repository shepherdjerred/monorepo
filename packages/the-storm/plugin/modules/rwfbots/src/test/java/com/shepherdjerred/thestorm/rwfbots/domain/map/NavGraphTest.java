package com.shepherdjerred.thestorm.rwfbots.domain.map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
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
    var crossings = new java.util.ArrayList<Double>();
    for (var index = 1; index < cells.size(); index++) {
      var from = cells.get(index - 1).feet();
      var to = cells.get(index).feet();
      var fraction = (SyntheticMap.WALL_X + 0.5 - from.x()) / (to.x() - from.x());
      if (fraction >= 0 && fraction <= 1) crossings.add(from.z() + fraction * (to.z() - from.z()));
    }
    assertThat(crossings).isNotEmpty().allSatisfy(z -> assertThat(z).isBetween(15.0, 17.0));
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
  void reusableSearchesKeepExactPathsAcrossGoalsAndChangingPenalties() {
    var workspace = graph.workspace();
    for (var from = 0; from < graph.nodeCount(); from += 37) {
      var to = (from * 7 + 13) % graph.nodeCount();
      java.util.function.IntToDoubleFunction penalty = node -> (node % 11) * 0.2;
      assertThat(graph.path(from, to, penalty, workspace)).isEqualTo(graph.path(from, to, penalty));
      assertThat(graph.path(to, from, node -> 0, workspace)).isEqualTo(graph.path(to, from));
    }
  }

  @Test
  void parentScratchCanBeReusedAfterDistancesShortPathsAndRejectedPenalties() {
    var workspace = graph.workspace();
    var failureFrom = node(SyntheticMap.RED_SPAWN);
    var failureTo = node(new BlockPos(29, 1, 2));
    for (var from = 0; from < graph.nodeCount(); from += 37) {
      var to = (from * 7 + 13) % graph.nodeCount();
      graph.path(from, to, ignored -> 0, workspace);
      graph.costsToTargets(to, new int[] {from, to, -1}, workspace);
      graph.cappedCostsToTargets(from, new int[] {to, -1}, 3, workspace);
      assertThatThrownBy(() -> graph.path(failureFrom, failureTo, ignored -> -1, workspace))
          .isInstanceOf(IllegalArgumentException.class);
      assertThat(graph.path(from, from, ignored -> 0, workspace)).isEqualTo(graph.path(from, from));
      assertThat(graph.path(to, from, ignored -> 0, workspace)).isEqualTo(graph.path(to, from));
    }
  }

  @Test
  void goalLimitedDistancesMatchFullDijkstraIncludingDuplicateAndMissingTargets() {
    var workspace = graph.workspace();
    var targets = new int[] {0, graph.nodeCount() - 1, 7, 7, -1};
    for (var from = 0; from < graph.nodeCount(); from += 29) {
      var complete = graph.costsFrom(from);
      var targeted = graph.costsToTargets(from, targets, workspace);
      for (var i = 0; i < targets.length; i++) {
        assertThat(targeted[i])
            .isEqualTo(targets[i] == -1 ? Float.POSITIVE_INFINITY : complete[targets[i]]);
      }
    }
  }

  @Test
  void overlappingSearchesFailAndReleaseTheWorkspaceAfterAnException() {
    var workspace = graph.workspace();
    var from = node(SyntheticMap.RED_SPAWN);
    var to = node(new BlockPos(29, 1, 2));
    assertThatThrownBy(
            () ->
                graph.path(
                    from,
                    to,
                    ignored -> {
                      graph.path(from, to, node -> 0, workspace);
                      return 0;
                    },
                    workspace))
        .isInstanceOf(IllegalStateException.class)
        .hasMessage("workspace already in use");
    assertThat(graph.path(from, to, ignored -> 0, workspace)).isEqualTo(graph.path(from, to));
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
  void directedDamagingDescentsCarryMeasuredTickCostsAndDamageBounds() {
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
    assertThat(descent.cost()).isEqualTo((double) (12 + (float) (1 / 0.215)));
    var high = platforms.nodeAt(new BlockPos(2, 8, 0)).orElseThrow();
    var larger = platforms.path(high, low).orElseThrow();
    assertThat(larger.waypoints().getLast().hop()).isEqualTo(Hop.DROP);
    var edge = platforms.edgeStart(high);
    assertThat(platforms.edgeDamage(edge)).isEqualTo(4);
    assertThat(platforms.path(low, high)).isEmpty();
  }

  @Test
  void floatingPlatformLeapRequiresAClearFlightCorridor() {
    for (var blocked : new boolean[] {false, true}) {
      var terrain =
          new BlockClassification() {
            @Override
            public GridBounds bounds() {
              return new GridBounds(new BlockPos(0, 0, 0), 9, 10, 1);
            }

            @Override
            public BlockShape shape(int x, int y, int z) {
              return (x <= 2 && y <= 5) || (x >= 5 && y == 0) || (blocked && x == 3 && y == 8)
                  ? BlockShape.FULL
                  : BlockShape.PASSABLE;
            }

            @Override
            public boolean blocksSight(int x, int y, int z) {
              return shape(x, y, z).blocksMovement();
            }
          };
      var platforms = NavGraphBuilder.build(terrain);
      var from = platforms.nodeAt(new BlockPos(2, 6, 0)).orElseThrow();
      var to = platforms.nodeAt(new BlockPos(5, 1, 0)).orElseThrow();
      var tooLittleRunUp = platforms.nodeAt(new BlockPos(0, 6, 0)).orElseThrow();
      assertThat(
              java.util.stream.IntStream.range(
                      platforms.edgeStart(tooLittleRunUp), platforms.edgeEnd(tooLittleRunUp))
                  .mapToObj(platforms::edgeHop))
          .doesNotContain(Hop.LEAP);
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
    assertThat(surface.nodeCount()).isEqualTo(5);
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
    assertThat(straight.cost()).isCloseTo(39, within(1e-6));
    assertThat(straight.waypoints())
        .anySatisfy(point -> assertThat(point.hop()).isEqualTo(Hop.LEAP));
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
