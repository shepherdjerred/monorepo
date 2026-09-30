package com.shepherdjerred.thestorm.mechanics.domain.piston;

import static com.shepherdjerred.thestorm.mechanics.domain.TestGrid.PLANKS;
import static com.shepherdjerred.thestorm.mechanics.domain.TestGrid.STONE;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.mechanics.domain.TestGrid;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Cell;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Mobility;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Shape;
import java.util.List;
import java.util.Set;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** A piston at the origin facing east (+x). */
final class PistonRulesTest {

  private static final String OBSIDIAN = "minecraft:obsidian";
  private static final String CHEST = "minecraft:chest";
  private static final String GLAZED = "minecraft:white_glazed_terracotta";
  private static final Pos PISTON = new Pos(0, 64, 0);
  private static final PistonRules RULES = new PistonRules(Set.of(OBSIDIAN, "minecraft:bedrock"));

  private static Pos at(int x) {
    return new Pos(x, 64, 0);
  }

  private static TestGrid blocksAt(int... xs) {
    var grid = new TestGrid();
    for (var x : xs) {
      grid.solid(at(x), x % 2 == 0 ? STONE : PLANKS);
    }
    return grid;
  }

  private static List<Integer> occupied(TestGrid grid) {
    return IntStream.rangeClosed(1, 20)
        .filter(x -> !grid.cellAt(at(x)).shape().isPlaceable())
        .boxed()
        .toList();
  }

  @Test
  void ordinaryBlocksCrush() {
    assertThat(RULES.crushable(Cell.solid(STONE))).isTrue();
    assertThat(RULES.crushable(new Cell("minecraft:torch", Shape.PASSABLE, Mobility.BREAK, false)))
        .isTrue();
  }

  @ParameterizedTest
  @ValueSource(strings = {"minecraft:obsidian", "minecraft:bedrock"})
  void blacklistedBlocksNeverCrush(String material) {
    assertThat(RULES.crushable(Cell.solid(material))).isFalse();
  }

  @Test
  void blockEntitiesAndUnbreakableBlocksNeverCrush() {
    assertThat(RULES.crushable(new Cell(CHEST, Shape.SOLID, Mobility.BLOCK, true))).isFalse();
    assertThat(RULES.crushable(new Cell("minecraft:barrier", Shape.SOLID, Mobility.BLOCK, true)))
        .isFalse();
  }

  @Test
  void emptySpaceAndWaterAreNothingToCrush() {
    assertThat(RULES.crushable(Cell.air())).isFalse();
    assertThat(RULES.crushable(new Cell("minecraft:water", Shape.LIQUID, Mobility.BREAK, false)))
        .isFalse();
  }

  @Test
  void superStickyCompactsTheLineTowardThePiston() {
    // After vanilla pulled one block to x=1, blocks wait at 3, 4 and 6.
    var grid = blocksAt(1, 3, 4, 6);

    var moves = RULES.pull(grid, PISTON, Direction.EAST, new PistonRules.Reach(8, 12));
    grid.move(moves);

    assertThat(moves)
        .containsExactly(
            new BlockMove(at(3), at(2)), new BlockMove(at(4), at(3)), new BlockMove(at(6), at(4)));
    assertThat(occupied(grid)).containsExactly(1, 2, 3, 4);
  }

  @Test
  void superStickyReachesOnlySoFar() {
    var grid = blocksAt(5, 9);

    var moves = RULES.pull(grid, PISTON, Direction.EAST, new PistonRules.Reach(8, 12));

    assertThat(moves).containsExactly(new BlockMove(at(5), at(1)));
  }

  @Test
  void superStickyMovesAtMostMaxBlocks() {
    var grid = blocksAt(2, 3, 4, 5);

    var moves = RULES.pull(grid, PISTON, Direction.EAST, new PistonRules.Reach(8, 2));
    grid.move(moves);

    assertThat(moves).hasSize(2);
    assertThat(occupied(grid)).containsExactly(1, 2, 4, 5);
  }

  @Test
  void superStickyStopsAtAnImmovableBlock() {
    var grid = blocksAt(2, 5).solid(at(3), OBSIDIAN);

    var moves = RULES.pull(grid, PISTON, Direction.EAST, new PistonRules.Reach(8, 12));

    assertThat(moves).containsExactly(new BlockMove(at(2), at(1)));
  }

  @Test
  void superStickyLeavesPushOnlyBlocksAndBlockEntities() {
    var grid =
        new TestGrid()
            .set(at(2), new Cell(GLAZED, Shape.SOLID, Mobility.PUSH_ONLY, false))
            .set(at(4), new Cell(CHEST, Shape.SOLID, Mobility.BLOCK, true));

    assertThat(RULES.pull(grid, PISTON, Direction.EAST, new PistonRules.Reach(8, 12))).isEmpty();
  }

  @Test
  void superPushSlidesTheLineAsFarAsThereIsRoom() {
    // Extended: head at x=1, the pushed line at 2..3, free space until stone at 7.
    var grid = blocksAt(2, 3).solid(at(7), OBSIDIAN);

    var moves = RULES.push(grid, PISTON, Direction.EAST, new PistonRules.Reach(4, 12));
    grid.move(moves);

    assertThat(moves).containsExactly(new BlockMove(at(3), at(6)), new BlockMove(at(2), at(5)));
    assertThat(occupied(grid)).containsExactly(5, 6, 7);
  }

  @Test
  void superPushTravelsAtMostItsDistance() {
    var grid = blocksAt(2);

    var moves = RULES.push(grid, PISTON, Direction.EAST, new PistonRules.Reach(3, 12));

    assertThat(moves).containsExactly(new BlockMove(at(2), at(5)));
  }

  @Test
  void aLineTooLongIsTooHeavy() {
    var grid = blocksAt(2, 3, 4);

    assertThat(RULES.push(grid, PISTON, Direction.EAST, new PistonRules.Reach(3, 2))).isEmpty();
  }

  @Test
  void aBlockedLineDoesNotMove() {
    var grid = blocksAt(2, 3).solid(at(4), OBSIDIAN);

    assertThat(RULES.push(grid, PISTON, Direction.EAST, new PistonRules.Reach(3, 12))).isEmpty();
  }

  @Test
  void aLineEndingInAChestDoesNotMove() {
    var grid = blocksAt(2).set(at(3), new Cell(CHEST, Shape.SOLID, Mobility.BLOCK, true));

    assertThat(RULES.push(grid, PISTON, Direction.EAST, new PistonRules.Reach(3, 12))).isEmpty();
  }

  @Test
  void pushOnlyBlocksArePushed() {
    var grid = new TestGrid().set(at(2), new Cell(GLAZED, Shape.SOLID, Mobility.PUSH_ONLY, false));

    assertThat(RULES.push(grid, PISTON, Direction.EAST, new PistonRules.Reach(2, 12)))
        .containsExactly(new BlockMove(at(2), at(4)));
  }

  @Test
  void nothingInFrontMeansNothingToPush() {
    assertThat(RULES.push(new TestGrid(), PISTON, Direction.EAST, new PistonRules.Reach(3, 12)))
        .isEmpty();
  }

  @Test
  void movesNeverCreateOrDestroyBlocks() {
    var grid = blocksAt(1, 3, 4, 6, 7, 10);
    var before = grid.countAll(STONE) + grid.countAll(PLANKS);

    grid.move(RULES.pull(grid, PISTON, Direction.EAST, new PistonRules.Reach(12, 12)));
    grid.move(RULES.push(grid, PISTON, Direction.EAST, new PistonRules.Reach(4, 12)));

    assertThat(grid.countAll(STONE) + grid.countAll(PLANKS)).isEqualTo(before);
  }

  @Test
  void bouncesLaunchAlongTheFacing() {
    assertThat(Velocity.toward(Direction.UP, 1.5)).isEqualTo(new Velocity(0, 1.5, 0));
    assertThat(Velocity.toward(Direction.WEST, 2)).isEqualTo(new Velocity(-2, 0, 0));
  }

  @Test
  void pistonsAreRecognised() {
    assertThat(PistonRules.isPiston("minecraft:piston")).isTrue();
    assertThat(PistonRules.isPiston("minecraft:sticky_piston")).isTrue();
    assertThat(PistonRules.isSticky("minecraft:piston")).isFalse();
    assertThat(PistonRules.isPiston(STONE)).isFalse();
  }
}
