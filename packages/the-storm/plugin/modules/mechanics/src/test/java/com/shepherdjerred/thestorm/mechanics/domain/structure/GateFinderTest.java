package com.shepherdjerred.thestorm.mechanics.domain.structure;

import static com.shepherdjerred.thestorm.mechanics.domain.TestGrid.FENCE;
import static com.shepherdjerred.thestorm.mechanics.domain.TestGrid.SPRUCE_FENCE;
import static com.shepherdjerred.thestorm.mechanics.domain.TestGrid.STONE;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.mechanics.domain.TestConfigs;
import com.shepherdjerred.thestorm.mechanics.domain.TestGrid;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

final class GateFinderTest {

  private static final Pos SIGN = new Pos(0, 64, 0);

  /** Ground at y=60, a closed gate of {@code width} columns at z=1 from y=61 to y=66. */
  private static TestGrid closedGate(int width) {
    var grid = new TestGrid().fill(new Pos(-6, 60, -6), new Pos(6, 60, 6), STONE);
    grid.sign(SIGN, "[Gate]", Direction.NORTH);
    for (var x = 0; x < width; x++) {
      grid.fill(new Pos(x, 61, 1), new Pos(x, 66, 1), FENCE);
    }
    return grid;
  }

  private static Structure found(TestGrid grid, int radius, int maxColumns, int maxHeight) {
    var result = GateFinder.find(grid, SIGN, TestConfigs.gate(radius, maxColumns, maxHeight));
    assertThat(result).isInstanceOf(Result.Ok.class);
    var gate = ((Result.Ok<Gate, StructureProblem>) result).value();
    return GateFinder.columns(grid, gate, maxHeight);
  }

  @Test
  void everyColumnBelowItsTopMoves() {
    var gate = found(closedGate(3), 3, 16, 12);

    assertThat(gate.material()).isEqualTo(FENCE);
    assertThat(gate.cells()).hasSize(3 * 5);
    assertThat(gate.cells()).doesNotContain(new Pos(0, 66, 1), new Pos(1, 66, 1));
    assertThat(gate.cells()).contains(new Pos(2, 61, 1), new Pos(0, 65, 1));
  }

  @Test
  void theTemplateIsTheNearestColumnTop() {
    assertThat(found(closedGate(3), 3, 16, 12).template()).isEqualTo(new Pos(0, 66, 1));
  }

  @Test
  void anOpenGateExtendsDownToTheGround() {
    var grid = closedGate(2);
    IntStream.rangeClosed(61, 65).forEach(y -> grid.air(new Pos(0, y, 1)).air(new Pos(1, y, 1)));
    grid.water(new Pos(1, 61, 1));

    var gate = found(grid, 3, 16, 12);

    assertThat(gate.cells()).hasSize(10).contains(new Pos(1, 61, 1));
  }

  @Test
  void aColumnStopsAtAnObstruction() {
    var grid = closedGate(1).solid(new Pos(0, 62, 1), STONE);

    assertThat(found(grid, 3, 16, 12).cells())
        .containsExactly(new Pos(0, 65, 1), new Pos(0, 64, 1), new Pos(0, 63, 1));
  }

  @Test
  void aColumnExtendsAtMostMaxHeight() {
    assertThat(found(closedGate(1), 3, 16, 2).cells())
        .containsExactly(new Pos(0, 65, 1), new Pos(0, 64, 1));
  }

  @Test
  void theNearestColumnsMaterialWinsAndOthersStay() {
    var grid = closedGate(1).fill(new Pos(2, 61, 2), new Pos(2, 66, 2), SPRUCE_FENCE);

    var gate = found(grid, 3, 16, 12);

    assertThat(gate.material()).isEqualTo(FENCE);
    assertThat(gate.cells()).allMatch(pos -> pos.x() == 0);
  }

  @Test
  void onlyTheNearestColumnsMove() {
    var gate = found(closedGate(4), 3, 2, 12);

    assertThat(gate.cells()).allMatch(pos -> pos.x() <= 1).hasSize(10);
  }

  @Test
  void aColumnTopOutsideTheSearchBoxStillCounts() {
    var grid = closedGate(1).fill(new Pos(0, 67, 1), new Pos(0, 70, 1), FENCE);

    var gate = found(grid, 3, 16, 12);

    assertThat(gate.template()).isEqualTo(new Pos(0, 70, 1));
    assertThat(gate.cells()).hasSize(9);
  }

  @Test
  void aPostWithNoRoomBelowIsNotAColumn() {
    // A lone fence post on the ground beside the sign, and a real column further away.
    var grid = closedGate(0).solid(new Pos(0, 61, -1), FENCE);
    grid.fill(new Pos(2, 61, 2), new Pos(2, 66, 2), FENCE);

    var result = GateFinder.find(grid, SIGN, TestConfigs.gate(3, 16, 12));

    assertThat(result.map(Gate::tops)).isEqualTo(Result.ok(java.util.List.of(new Pos(2, 66, 2))));
  }

  @Test
  void onlyPostsMeansNoGate() {
    var grid = closedGate(0).solid(new Pos(0, 61, -1), FENCE).solid(new Pos(1, 61, 1), FENCE);

    assertThat(GateFinder.find(grid, SIGN, TestConfigs.gate(3, 16, 12)))
        .isEqualTo(Result.err(new StructureProblem.NoGate(3)));
  }

  @Test
  void aColumnStopsAtAnotherColumnsTop() {
    // Two separate fence runs in one column: 61-62 and 65-66, with air between.
    var grid = new TestGrid().fill(new Pos(-4, 60, -4), new Pos(4, 60, 4), STONE);
    grid.sign(SIGN, "[Gate]", Direction.NORTH);
    grid.fill(new Pos(0, 61, 1), new Pos(0, 62, 1), FENCE);
    grid.fill(new Pos(0, 65, 1), new Pos(0, 66, 1), FENCE);

    var gate = found(grid, 3, 16, 12);

    // The upper column stops one block above the lower column's top, so they never merge.
    assertThat(gate.cells())
        .containsExactlyInAnyOrder(new Pos(0, 65, 1), new Pos(0, 64, 1), new Pos(0, 61, 1));
  }

  @Test
  void noColumnsMeansNoGate() {
    var grid = new TestGrid().sign(SIGN, "[Gate]", Direction.NORTH).solid(new Pos(5, 64, 0), FENCE);

    var result = GateFinder.find(grid, SIGN, TestConfigs.gate(3, 16, 12));

    assertThat(result).isEqualTo(Result.err(new StructureProblem.NoGate(3)));
  }

  @Test
  void aGateOpensAndClosesWithoutGainingOrLosingFences() {
    var grid = closedGate(3);
    var fences = grid.countAll(FENCE);
    var stock = Stock.empty();

    for (var round = 0; round < 4; round++) {
      var gate = found(grid, 3, 16, 12);
      var result = StructureToggle.plan(gate, grid, stock, Target.TOGGLE);
      var plan = ((Result.Ok<StructurePlan, StructureProblem>) result).value();
      grid.apply(plan.changes());
      stock = plan.stock();

      assertThat(grid.countAll(FENCE) + stock.count()).isEqualTo(fences);
      assertThat(grid.countAll(FENCE)).isEqualTo(round % 2 == 0 ? 3 : fences);
    }
  }
}
