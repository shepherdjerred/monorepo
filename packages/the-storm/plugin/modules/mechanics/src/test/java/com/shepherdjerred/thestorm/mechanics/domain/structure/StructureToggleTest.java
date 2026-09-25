package com.shepherdjerred.thestorm.mechanics.domain.structure;

import static com.shepherdjerred.thestorm.mechanics.domain.TestGrid.PLANKS;
import static com.shepherdjerred.thestorm.mechanics.domain.TestGrid.SPRUCE;
import static com.shepherdjerred.thestorm.mechanics.domain.TestGrid.STONE;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.mechanics.domain.TestGrid;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Cell;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import java.util.ArrayList;
import java.util.List;
import java.util.SplittableRandom;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

final class StructureToggleTest {

  private static final List<Target> TARGETS = List.of(Target.OPEN, Target.CLOSE, Target.TOGGLE);

  private static final List<Pos> CELLS =
      IntStream.range(0, 5).mapToObj(z -> new Pos(0, 63, z)).toList();
  private static final Structure BRIDGE = new Structure(PLANKS, new Pos(0, 63, -1), CELLS);

  private static StructurePlan plan(TestGrid grid, Stock stock, Target target) {
    var result = StructureToggle.plan(BRIDGE, grid, stock, target);
    assertThat(result).isInstanceOf(Result.Ok.class);
    return ((Result.Ok<StructurePlan, StructureProblem>) result).value();
  }

  private static StructureProblem refusal(TestGrid grid, Stock stock, Target target) {
    var result = StructureToggle.plan(BRIDGE, grid, stock, target);
    assertThat(result).isInstanceOf(Result.Err.class);
    return ((Result.Err<StructurePlan, StructureProblem>) result).error();
  }

  private static TestGrid built() {
    var grid = new TestGrid();
    CELLS.forEach(pos -> grid.solid(pos, PLANKS));
    return grid;
  }

  @Test
  void openingTakesEveryBlockIntoTheStock() {
    var grid = built();

    var plan = plan(grid, Stock.empty(), Target.TOGGLE);

    assertThat(plan.opened()).isTrue();
    assertThat(plan.changes()).hasSize(5).allMatch(BlockChange::isRemoval);
    assertThat(plan.stock()).isEqualTo(Stock.of(PLANKS, 5));
  }

  @Test
  void closingPlacesTheStockBack() {
    var grid = new TestGrid();

    var plan = plan(grid, Stock.of(PLANKS, 5), Target.TOGGLE);

    assertThat(plan.opened()).isFalse();
    assertThat(plan.changes()).extracting(BlockChange::to).containsOnly(PLANKS).hasSize(5);
    assertThat(plan.stock()).isEqualTo(Stock.empty());
  }

  @Test
  void closingKeepsWhatIsLeftOver() {
    var plan = plan(new TestGrid(), Stock.of(PLANKS, 9), Target.CLOSE);

    assertThat(plan.stock()).isEqualTo(Stock.of(PLANKS, 4));
  }

  @Test
  void closingFillsWaterButLeavesAirWhenOpened() {
    var grid = new TestGrid().water(CELLS.get(2));

    var closed = plan(grid, Stock.of(PLANKS, 5), Target.CLOSE);
    grid.apply(closed.changes());
    var opened = plan(grid, closed.stock(), Target.OPEN);
    grid.apply(opened.changes());

    assertThat(grid.cellAt(CELLS.get(2))).isEqualTo(Cell.air());
    assertThat(opened.stock()).isEqualTo(Stock.of(PLANKS, 5));
  }

  @Test
  void aPartlyStandingStructureOpens() {
    var grid = new TestGrid().solid(CELLS.get(1), PLANKS).solid(CELLS.get(3), PLANKS);

    var plan = plan(grid, Stock.of(PLANKS, 3), Target.TOGGLE);

    assertThat(plan.opened()).isTrue();
    assertThat(plan.changes())
        .extracting(BlockChange::pos)
        .containsExactly(CELLS.get(1), CELLS.get(3));
    assertThat(plan.stock()).isEqualTo(Stock.of(PLANKS, 5));
  }

  @Test
  void openingLeavesOtherBlocksAlone() {
    var grid = built().solid(CELLS.get(0), STONE).solid(CELLS.get(4), SPRUCE);

    var plan = plan(grid, Stock.empty(), Target.OPEN);

    assertThat(plan.changes())
        .extracting(BlockChange::pos)
        .containsExactly(CELLS.subList(1, 4).toArray(Pos[]::new));
  }

  @Test
  void anObstructionRefusesTheWholeClose() {
    var grid = new TestGrid().solid(CELLS.get(3), STONE);

    assertThat(refusal(grid, Stock.of(PLANKS, 5), Target.CLOSE))
        .isEqualTo(new StructureProblem.Obstructed(CELLS.get(3), STONE));
  }

  @Test
  void aShortStockRefusesTheWholeClose() {
    var grid = new TestGrid().solid(CELLS.get(0), PLANKS);

    assertThat(refusal(grid, Stock.of(PLANKS, 3), Target.CLOSE))
        .isEqualTo(new StructureProblem.NotEnoughBlocks(PLANKS, 4, 3));
  }

  @Test
  void aStockOfAnotherMaterialIsRefused() {
    var spruce = Stock.of(SPRUCE, 5);

    assertThat(refusal(new TestGrid(), spruce, Target.CLOSE))
        .isEqualTo(new StructureProblem.WrongStock(spruce, PLANKS));
    assertThat(refusal(built(), spruce, Target.OPEN))
        .isEqualTo(new StructureProblem.WrongStock(spruce, PLANKS));
  }

  @Test
  void openingAnOpenStructureChangesNothing() {
    var plan = plan(new TestGrid(), Stock.of(PLANKS, 5), Target.OPEN);

    assertThat(plan.opened()).isTrue();
    assertThat(plan.changes()).isEmpty();
    assertThat(plan.stock()).isEqualTo(Stock.of(PLANKS, 5));
  }

  @Test
  void closingAClosedStructureChangesNothing() {
    var plan = plan(built(), Stock.empty(), Target.CLOSE);

    assertThat(plan.opened()).isFalse();
    assertThat(plan.changes()).isEmpty();
  }

  @Test
  void aCellListedTwiceIsCountedOnce() {
    var twice = new ArrayList<>(CELLS);
    twice.addAll(CELLS);
    var structure = new Structure(PLANKS, new Pos(0, 63, -1), twice);

    var result = StructureToggle.plan(structure, built(), Stock.empty(), Target.OPEN);

    assertThat(result.map(StructurePlan::stock)).isEqualTo(Result.ok(Stock.of(PLANKS, 5)));
  }

  @Test
  void depositsAddTheStructuresOwnMaterialOnly() {
    assertThat(StructureToggle.deposit(PLANKS, Stock.of(PLANKS, 2), Stock.of(PLANKS, 3)))
        .isEqualTo(Result.ok(Stock.of(PLANKS, 5)));
    assertThat(StructureToggle.deposit(PLANKS, Stock.empty(), Stock.of(SPRUCE, 3)))
        .isEqualTo(Result.err(new StructureProblem.WrongMaterial(PLANKS, SPRUCE)));
    assertThat(StructureToggle.deposit(PLANKS, Stock.of(SPRUCE, 1), Stock.of(PLANKS, 3)))
        .isEqualTo(Result.err(new StructureProblem.WrongStock(Stock.of(SPRUCE, 1), PLANKS)));
    assertThat(StructureToggle.deposit(PLANKS, Stock.of(PLANKS, 2), Stock.empty()))
        .isEqualTo(Result.ok(Stock.of(PLANKS, 2)));
  }

  /**
   * The conservation law: across any sequence of opens, closes and toggles, on any starting world,
   * the structure's blocks in the world plus its stock never change, and nothing else in the world
   * changes. Refused plans change nothing at all.
   */
  @ParameterizedTest
  @ValueSource(longs = {1, 2, 3, 5, 8, 13, 21, 34, 55, 89})
  void noBlockIsEverCreatedOrDestroyed(long seed) {
    var random = new SplittableRandom(seed);
    var cells = IntStream.range(0, 12).mapToObj(z -> new Pos(0, 63, z)).toList();
    var structure = new Structure(PLANKS, new Pos(0, 63, -1), cells);
    var grid = new TestGrid();
    for (var pos : cells) {
      switch (random.nextInt(6)) {
        case 0, 1, 2 -> grid.solid(pos, PLANKS);
        case 3 -> grid.water(pos);
        case 4 -> grid.solid(pos, STONE);
        default -> grid.air(pos);
      }
    }
    var stock = Stock.of(PLANKS, random.nextInt(8));
    var total = grid.countAll(PLANKS) + stock.count();
    var stone = grid.countAll(STONE);
    for (var step = 0; step < 200; step++) {
      var target = TARGETS.get(random.nextInt(TARGETS.size()));
      if (random.nextInt(10) == 0) {
        // Someone mines an obstruction away or drops stone into the gap between toggles.
        var pos = cells.get(random.nextInt(cells.size()));
        if (grid.cellAt(pos).is(STONE)) {
          grid.air(pos);
          stone--;
        } else if (grid.cellAt(pos).shape().isPlaceable()) {
          grid.solid(pos, STONE);
          stone++;
        }
      }
      var result = StructureToggle.plan(structure, grid, stock, target);
      if (result instanceof Result.Ok<StructurePlan, StructureProblem>(var plan)) {
        grid.apply(plan.changes());
        stock = plan.stock();
      }
      assertThat(grid.countAll(PLANKS) + stock.count()).isEqualTo(total);
      assertThat(grid.countAll(STONE)).isEqualTo(stone);
    }
  }
}
