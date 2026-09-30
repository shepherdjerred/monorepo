package com.shepherdjerred.thestorm.mechanics.domain.structure;

import static com.shepherdjerred.thestorm.mechanics.domain.TestGrid.PLANKS;
import static com.shepherdjerred.thestorm.mechanics.domain.TestGrid.SPRUCE;
import static com.shepherdjerred.thestorm.mechanics.domain.TestGrid.STONE;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.mechanics.domain.TestConfigs;
import com.shepherdjerred.thestorm.mechanics.domain.TestGrid;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Mount;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.grid.SignView;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Mechanism;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

final class SpanFinderTest {

  private static final Pos SIGN = new Pos(0, 64, 0);

  private static Span found(Result<Span, StructureProblem> result) {
    assertThat(result).isInstanceOf(Result.Ok.class);
    return ((Result.Ok<Span, StructureProblem>) result).value();
  }

  private static StructureProblem problem(Result<Span, StructureProblem> result) {
    assertThat(result).isInstanceOf(Result.Err.class);
    return ((Result.Err<Span, StructureProblem>) result).error();
  }

  private static List<Pos> row(int y, int x, int fromZ, int toZ) {
    return java.util.stream.IntStream.rangeClosed(fromZ, toZ)
        .mapToObj(z -> new Pos(x, y, z))
        .toList();
  }

  @Nested
  final class Bridges {

    /** A sign facing north at the origin runs its bridge south, one block below. */
    private TestGrid bridge(int length) {
      var far = SIGN.offset(Direction.SOUTH, length + 1);
      return new TestGrid()
          .sign(SIGN, "[Bridge]", Direction.NORTH)
          .solid(SIGN.offset(Direction.DOWN), PLANKS)
          .sign(far, "[Bridge]", Direction.SOUTH)
          .solid(far.offset(Direction.DOWN), PLANKS);
    }

    private Result<Span, StructureProblem> find(TestGrid grid) {
      return SpanFinder.bridge(
          grid, SIGN, grid.signAt(SIGN).orElseThrow(), TestConfigs.span(10, 2));
    }

    @Test
    void runsBehindTheSignLevelWithItsBase() {
      var span = found(find(bridge(5)));

      assertThat(span.structure().material()).isEqualTo(PLANKS);
      assertThat(span.structure().template()).isEqualTo(new Pos(0, 63, 0));
      assertThat(span.farSign()).isEqualTo(new Pos(0, 64, 6));
      assertThat(span.structure().cells()).containsExactlyElementsOf(row(63, 0, 1, 5));
    }

    @Test
    void preferTheBaseAboveTheSign() {
      var far = SIGN.offset(Direction.SOUTH, 4);
      var grid =
          bridge(3)
              .solid(SIGN.offset(Direction.UP), SPRUCE)
              .solid(far.offset(Direction.UP), SPRUCE);

      var span = found(find(grid));

      assertThat(span.structure().material()).isEqualTo(SPRUCE);
      assertThat(span.structure().cells()).containsExactlyElementsOf(row(65, 0, 1, 3));
    }

    @Test
    void widensWithMatchingBlocksBesideBothBases() {
      var far = new Pos(0, 63, 4);
      var grid =
          bridge(3)
              .solid(new Pos(1, 63, 0), PLANKS)
              .solid(new Pos(-1, 63, 0), PLANKS)
              .solid(new Pos(-2, 63, 0), PLANKS)
              .solid(far.offset(1, 0, 0), PLANKS)
              .solid(far.offset(-1, 0, 0), PLANKS)
              .solid(far.offset(-2, 0, 0), PLANKS);

      var cells = found(find(grid)).structure().cells();

      assertThat(cells).hasSize(3 * 4);
      assertThat(cells).contains(new Pos(-2, 63, 1), new Pos(1, 63, 3));
      assertThat(cells).doesNotContain(new Pos(2, 63, 1), new Pos(-3, 63, 1));
    }

    @Test
    void widthStopsAtTheConfiguredLimit() {
      var far = new Pos(0, 63, 4);
      var grid = bridge(3);
      for (var x = -4; x <= 4; x++) {
        grid.solid(new Pos(x, 63, 0), PLANKS).solid(far.offset(x, 0, 0), PLANKS);
      }

      var cells = found(find(grid)).structure().cells();

      assertThat(cells).hasSize(5 * 3);
    }

    @Test
    void endsOfDifferentWidthsAreRefused() {
      var grid = bridge(3).solid(new Pos(1, 63, 0), PLANKS);

      assertThat(problem(find(grid))).isInstanceOf(StructureProblem.WidthsDiffer.class);
    }

    @Test
    void endsOfDifferentMaterialsAreRefused() {
      var grid = bridge(3).solid(new Pos(0, 63, 4), SPRUCE);

      assertThat(problem(find(grid))).isEqualTo(new StructureProblem.EndsDiffer(PLANKS, SPRUCE));
    }

    @Test
    void theLongestAllowedBridgeIsFoundAndOneLongerIsNot() {
      assertThat(found(find(bridge(10))).structure().cells()).hasSize(10);
      assertThat(problem(find(bridge(11)))).isInstanceOf(StructureProblem.NoFarEnd.class);
    }

    @Test
    void touchingEndsAreTooShort() {
      assertThat(problem(find(bridge(0)))).isInstanceOf(StructureProblem.TooShort.class);
    }

    @Test
    void obstructionsDoNotStopTheSearch() {
      var grid = bridge(4).solid(new Pos(0, 63, 2), STONE).solid(new Pos(0, 64, 2), STONE);

      assertThat(found(find(grid)).structure().cells()).hasSize(4);
    }

    @Test
    void otherSignsOnTheWayAreSkipped() {
      var grid = bridge(4).sign(new Pos(0, 64, 2), "[Gate]", Direction.NORTH);

      assertThat(found(find(grid)).farSign()).isEqualTo(new Pos(0, 64, 5));
    }

    @Test
    void aSignFacingADiagonalIsRefused() {
      var grid = bridge(3);
      var diagonal =
          new SignView(List.of("", "[Bridge]", "", ""), Mount.STANDING, Optional.empty());

      var result = SpanFinder.bridge(grid, SIGN, diagonal, TestConfigs.span(10, 2));

      assertThat(problem(result)).isInstanceOf(StructureProblem.NotSquare.class);
    }

    @Test
    void aBaseOfTheWrongMaterialIsRefused() {
      var grid = bridge(3).solid(SIGN.offset(Direction.DOWN), STONE);

      assertThat(problem(find(grid)))
          .isEqualTo(new StructureProblem.NoBase("directly above or below the sign", STONE));
    }
  }

  @Nested
  final class Doors {

    /** A door column at x=0, z=0 from y=65 (base) to y=65+height+1 (top base). */
    private TestGrid door(int height) {
      var top = SIGN.offset(Direction.UP, height + 3);
      return new TestGrid()
          .sign(SIGN, "[Door Up]", Direction.NORTH)
          .solid(SIGN.offset(Direction.UP), PLANKS)
          .solid(top.offset(Direction.DOWN), PLANKS)
          .sign(top, "[Door Down]", Direction.NORTH);
    }

    private Result<Span, StructureProblem> find(TestGrid grid, Pos sign) {
      return SpanFinder.door(grid, sign, grid.signAt(sign).orElseThrow(), TestConfigs.span(6, 1));
    }

    @Test
    void risesFromTheBaseAboveADoorUpSign() {
      var span = found(find(door(3), SIGN));

      assertThat(span.structure().cells())
          .containsExactly(new Pos(0, 66, 0), new Pos(0, 67, 0), new Pos(0, 68, 0));
      assertThat(span.farSign()).isEqualTo(new Pos(0, 70, 0));
    }

    @Test
    void theTopSignFindsTheSameDoorGoingDown() {
      var top = new Pos(0, 70, 0);

      var span = found(find(door(3), top));

      assertThat(span.structure().cells())
          .containsExactlyInAnyOrder(new Pos(0, 66, 0), new Pos(0, 67, 0), new Pos(0, 68, 0));
      assertThat(span.structure().template()).isEqualTo(new Pos(0, 69, 0));
      assertThat(span.farSign()).isEqualTo(SIGN);
    }

    @Test
    void widensAcrossTheSignsFace() {
      var grid =
          door(2)
              .solid(new Pos(1, 65, 0), PLANKS)
              .solid(new Pos(1, 68, 0), PLANKS)
              // Blocks in front of the sign's face do not widen the door.
              .solid(new Pos(0, 65, -1), PLANKS)
              .solid(new Pos(0, 68, -1), PLANKS);

      var cells = found(find(grid, SIGN)).structure().cells();

      assertThat(cells)
          .containsExactlyInAnyOrder(
              new Pos(0, 66, 0), new Pos(1, 66, 0), new Pos(0, 67, 0), new Pos(1, 67, 0));
    }

    @Test
    void theTallestAllowedDoorIsFoundAndOneTallerIsNot() {
      assertThat(found(find(door(6), SIGN)).structure().cells()).hasSize(6);
      assertThat(problem(find(door(7), SIGN))).isInstanceOf(StructureProblem.NoFarEnd.class);
    }

    @Test
    void aDoorUpSignNeedsItsBaseAbove() {
      var grid = door(3).air(SIGN.offset(Direction.UP)).solid(SIGN.offset(Direction.DOWN), PLANKS);

      assertThat(problem(find(grid, SIGN)))
          .isEqualTo(new StructureProblem.NoBase("directly above the sign", "minecraft:air"));
    }

    @Test
    void aBridgeSignDoesNotEndADoor() {
      var grid = door(3).sign(new Pos(0, 70, 0), "[Bridge]", Direction.NORTH);

      assertThat(problem(find(grid, SIGN))).isInstanceOf(StructureProblem.NoFarEnd.class);
    }

    @Test
    void theSearchStopsAtTheTopOfTheWorld() {
      var nearTop = new Pos(0, 316, 0);
      var grid =
          new TestGrid()
              .sign(nearTop, "[Door Up]", Direction.NORTH)
              .solid(nearTop.offset(Direction.UP), PLANKS);

      assertThat(problem(find(grid, nearTop))).isInstanceOf(StructureProblem.NoFarEnd.class);
    }

    @Test
    void doorBaseRejectsOtherSigns() {
      var grid = door(3);
      org.assertj.core.api.Assertions.assertThatThrownBy(
              () -> SpanFinder.doorBase(grid, SIGN, Mechanism.BRIDGE, TestConfigs.span(6, 1)))
          .isInstanceOf(IllegalArgumentException.class);
    }
  }
}
