package com.shepherdjerred.thestorm.mechanics.domain.structure;

import static com.shepherdjerred.thestorm.mechanics.domain.TestGrid.FENCE;
import static com.shepherdjerred.thestorm.mechanics.domain.TestGrid.PLANKS;
import static com.shepherdjerred.thestorm.mechanics.domain.TestGrid.SPRUCE;
import static com.shepherdjerred.thestorm.mechanics.domain.TestGrid.STONE;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.mechanics.domain.TestConfigs;
import com.shepherdjerred.thestorm.mechanics.domain.TestGrid;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import java.util.List;
import java.util.Optional;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * Binding structure signs at creation and checking the binding on use, over a grid that pops signs
 * off like real physics and drops what they hold.
 */
final class StructureBinderTest {

  private static final StructureBinder BINDER = new StructureBinder(TestConfigs.mechanics());

  /** The near end: a sign facing north, its base below; the bridge runs south. */
  private static final Pos NEAR = new Pos(0, 64, 0);

  /** The far end, five blocks south, facing back north-to-south. */
  private static final Pos FAR = new Pos(0, 64, 5);

  private static final List<Pos> CELLS =
      IntStream.rangeClosed(1, 4).mapToObj(z -> new Pos(0, 63, z)).toList();

  /** A closed plank bridge with only its near sign written, not yet bound. */
  private static TestGrid bridge() {
    var grid =
        new TestGrid()
            .sign(NEAR, "[Bridge]", Direction.NORTH)
            .solid(new Pos(0, 63, 0), PLANKS)
            .solid(new Pos(0, 63, 5), PLANKS);
    CELLS.forEach(pos -> grid.solid(pos, PLANKS));
    return grid;
  }

  /** Writes the far end's sign. */
  private static TestGrid withFar(TestGrid grid) {
    return grid.sign(FAR, "[Bridge]", Direction.SOUTH);
  }

  private static StructureBinder.Site site(TestGrid grid, Pos sign) {
    return new StructureBinder.Site(grid, grid, sign, grid.signAt(sign).orElseThrow());
  }

  private static StructureBinder.Bind bound(TestGrid grid, Pos sign) {
    var result = BINDER.bind(site(grid, sign));
    assertThat(result).isInstanceOf(Result.Ok.class);
    var bind = ((Result.Ok<StructureBinder.Bind, StructureProblem>) result).value();
    bind.writes().forEach(write -> grid.bind(write.sign(), write.binding()));
    return bind;
  }

  private static StructureProblem bindRefusal(TestGrid grid, Pos sign) {
    var result = BINDER.bind(site(grid, sign));
    assertThat(result).isInstanceOf(Result.Err.class);
    return ((Result.Err<StructureBinder.Bind, StructureProblem>) result).error();
  }

  private static StructureBinder.Bound resolved(TestGrid grid, Pos sign) {
    var result = BINDER.resolve(site(grid, sign));
    assertThat(result).isInstanceOf(Result.Ok.class);
    return ((Result.Ok<StructureBinder.Bound, StructureProblem>) result).value();
  }

  private static StructureProblem useRefusal(TestGrid grid, Pos sign) {
    var result = BINDER.resolve(site(grid, sign));
    assertThat(result).isInstanceOf(Result.Err.class);
    return ((Result.Err<StructureBinder.Bound, StructureProblem>) result).error();
  }

  /** Written in order: the near end first, then the far end, which links both. */
  private static TestGrid linkedBridge() {
    var grid = bridge();
    bound(grid, NEAR);
    withFar(grid);
    bound(grid, FAR);
    return grid;
  }

  /**
   * Toggles as the adapter does: resolve, plan with the keeper's stock, store the new stock, then
   * move blocks. Returns whether anything happened.
   */
  private static boolean toggle(TestGrid grid, Pos sign) {
    if (!(BINDER.resolve(site(grid, sign))
        instanceof Result.Ok<StructureBinder.Bound, StructureProblem>(var bound))) {
      return false;
    }
    var keeper = bound.keeper();
    var planned =
        StructureToggle.plan(bound.structure(), grid, grid.stockAt(keeper), Target.TOGGLE);
    if (!(planned instanceof Result.Ok<StructurePlan, StructureProblem>(var plan))) {
      return false;
    }
    grid.stock(keeper, plan.stock());
    grid.apply(plan.changes());
    return true;
  }

  private static long planksEverywhere(TestGrid grid) {
    return grid.countAll(PLANKS) + grid.heldAll(PLANKS) + grid.dropped(PLANKS);
  }

  @Nested
  final class Linking {

    @Test
    void theFirstEndIsBoundAloneAndKeepsTheStock() {
      var grid = bridge();

      var bind = bound(grid, NEAR);

      assertThat(bind.cells()).isEmpty();
      assertThat(grid.bindingAt(NEAR))
          .contains(new Binding.SpanEnd(PLANKS, new Pos(0, 63, 0), Optional.empty(), true));
    }

    @Test
    void theSecondEndLinksBothAndTheFirstKeepsTheStock() {
      var grid = bridge();
      bound(grid, NEAR);
      withFar(grid);

      var bind = bound(grid, FAR);

      assertThat(bind.cells()).containsExactlyInAnyOrderElementsOf(CELLS);
      assertThat(grid.bindingAt(NEAR))
          .contains(new Binding.SpanEnd(PLANKS, new Pos(0, 63, 0), Optional.of(FAR), true));
      assertThat(grid.bindingAt(FAR))
          .contains(new Binding.SpanEnd(PLANKS, new Pos(0, 63, 5), Optional.of(NEAR), false));
    }

    @Test
    void anEndThatWasNeverSetUpCannotBeLinked() {
      assertThat(bindRefusal(withFar(bridge()), FAR))
          .isEqualTo(new StructureProblem.FarNotSetUp(NEAR));
    }

    @Test
    void anEndLinkedToAnotherLivingEndIsTaken() {
      var grid = withFar(bridge());
      var other = new Pos(0, 64, -5);
      grid.sign(other, "[Bridge]", Direction.SOUTH)
          .bind(other, new Binding.SpanEnd(PLANKS, new Pos(0, 63, -5), Optional.of(NEAR), false))
          .bind(NEAR, new Binding.SpanEnd(PLANKS, new Pos(0, 63, 0), Optional.of(other), true));

      assertThat(bindRefusal(grid, FAR)).isEqualTo(new StructureProblem.FarTaken(NEAR));
    }

    @Test
    void anEndWhosePartnerIsGoneLinksAgainAndKeepsItsStock() {
      var grid = withFar(bridge());
      var gone = new Pos(0, 64, -5);
      grid.bind(NEAR, new Binding.SpanEnd(PLANKS, new Pos(0, 63, 0), Optional.of(gone), true))
          .stock(NEAR, Stock.of(PLANKS, 3));

      bound(grid, FAR);

      assertThat(grid.bindingAt(NEAR).map(Binding.SpanEnd.class::cast))
          .hasValueSatisfying(end -> assertThat(end.partner()).contains(FAR));
      assertThat(grid.stockAt(NEAR)).isEqualTo(Stock.of(PLANKS, 3));
    }

    @Test
    void rewritingASignThatHoldsBlocksIsRefused() {
      var grid = bridge();
      bound(grid, NEAR);
      grid.stock(NEAR, Stock.of(PLANKS, 4));

      assertThat(bindRefusal(grid, NEAR))
          .isEqualTo(new StructureProblem.HoldsStock(Stock.of(PLANKS, 4)));
    }

    @Test
    void aBridgeHoldingUpASignCannotBeLinked() {
      var grid = bridge();
      bound(grid, NEAR);
      withFar(grid);
      // A wall sign hangs on the side of the second bridge block.
      grid.wallSign(new Pos(1, 63, 2), "Welcome", Direction.EAST);

      assertThat(bindRefusal(grid, FAR)).isEqualTo(new StructureProblem.Supports(CELLS.get(1)));
    }

    @Test
    void aBridgeHoldingUpATorchCannotBeLinked() {
      var grid = bridge().holdsUp(CELLS.get(3));
      bound(grid, NEAR);
      withFar(grid);

      assertThat(bindRefusal(grid, FAR)).isEqualTo(new StructureProblem.Supports(CELLS.get(3)));
    }
  }

  @Nested
  final class Using {

    @Test
    void eitherEndFindsTheSameStructureAndTheFirstEndKeepsTheStock() {
      var grid = linkedBridge();

      var fromNear = resolved(grid, NEAR);
      var fromFar = resolved(grid, FAR);

      assertThat(fromNear.keeper()).isEqualTo(NEAR);
      assertThat(fromFar.keeper()).isEqualTo(NEAR);
      assertThat(fromFar.structure().cells())
          .containsExactlyInAnyOrderElementsOf(fromNear.structure().cells());
    }

    @Test
    void anUnlinkedEndSaysWhatToBuild() {
      var grid = bridge();
      bound(grid, NEAR);

      assertThat(useRefusal(grid, NEAR)).isEqualTo(new StructureProblem.NotLinked("[Bridge]"));
    }

    @Test
    void aRewrittenPartnerIsMissing() {
      var grid = linkedBridge();
      grid.sign(FAR, "[Bridge]", Direction.SOUTH);

      assertThat(useRefusal(grid, NEAR)).isEqualTo(new StructureProblem.PartnerMissing(FAR));
    }

    @Test
    void aSignWithoutABindingIsNotSetUp() {
      assertThat(useRefusal(bridge(), NEAR)).isEqualTo(new StructureProblem.NotBound());
    }

    @Test
    void replacedEndBlocksRefuseRatherThanMovingAnotherMaterial() {
      var grid = linkedBridge().solid(new Pos(0, 63, 0), SPRUCE).solid(new Pos(0, 63, 5), SPRUCE);

      assertThat(useRefusal(grid, NEAR)).isInstanceOf(StructureProblem.Changed.class);
      assertThat(grid.countAll(PLANKS)).isEqualTo(4);
    }

    @Test
    void aNewSignBetweenTheEndsRefuses() {
      var grid = linkedBridge().sign(new Pos(0, 64, 3), "[Bridge]", Direction.SOUTH);

      assertThat(useRefusal(grid, NEAR))
          .isEqualTo(new StructureProblem.Changed("another sign now stands between the ends"));
    }

    @Test
    void aSignAttachedToTheBridgeStopsItOpeningInsteadOfPoppingOff() {
      var grid = linkedBridge();
      var hanger = new Pos(1, 63, 2);
      grid.wallSign(hanger, "[Bridge]", Direction.EAST).stock(hanger, Stock.of(PLANKS, 9));
      var before = planksEverywhere(grid);

      assertThat(toggle(grid, NEAR)).isFalse();

      assertThat(grid.signAt(hanger)).isPresent();
      assertThat(grid.dropped(PLANKS)).isZero();
      assertThat(planksEverywhere(grid)).isEqualTo(before);
    }

    @Test
    void theBlocksSurviveEveryToggleAndTheKeeperBreakingMidCycle() {
      var grid = linkedBridge();
      var total = planksEverywhere(grid);

      for (var round = 0; round < 12; round++) {
        assertThat(toggle(grid, round % 2 == 0 ? NEAR : FAR)).isTrue();
        assertThat(planksEverywhere(grid)).isEqualTo(total);
      }
      // Open it, then break the sign holding the blocks: they drop, nothing more.
      toggle(grid, FAR);
      assertThat(grid.stockAt(NEAR)).isEqualTo(Stock.of(PLANKS, 4));
      grid.breakSign(NEAR);

      assertThat(grid.dropped(PLANKS)).isEqualTo(4);
      assertThat(toggle(grid, FAR)).isFalse();
      assertThat(useRefusal(grid, FAR)).isEqualTo(new StructureProblem.PartnerMissing(NEAR));
      assertThat(planksEverywhere(grid)).isEqualTo(total);
    }
  }

  @Nested
  final class Gates {

    private static final Pos SIGN = new Pos(0, 64, 0);

    /** Ground at y=60 and a closed two-column fence gate at z=1 from y=61 to y=66. */
    private TestGrid gate() {
      var grid = new TestGrid().fill(new Pos(-5, 60, -5), new Pos(5, 60, 5), STONE);
      grid.sign(SIGN, "[Gate]", Direction.NORTH);
      grid.fill(new Pos(0, 61, 1), new Pos(1, 66, 1), FENCE);
      return grid;
    }

    @Test
    void aGateSignRemembersItsColumnTops() {
      var grid = gate();

      var bind = bound(grid, SIGN);

      // Ten moving cells plus the two tops, which the creator must also be allowed to change.
      assertThat(bind.cells()).hasSize(12).contains(new Pos(0, 66, 1), new Pos(1, 66, 1));
      assertThat(grid.bindingAt(SIGN))
          .contains(
              new Binding.GateFrame(
                  new Gate(FENCE, new Pos(0, 66, 1), List.of(new Pos(0, 66, 1), new Pos(1, 66, 1))),
                  Optional.empty(),
                  true));
    }

    @Test
    void anotherGateSignNearbyIsNeverTouched() {
      var grid = gate();
      var other = new Pos(1, 64, 0);
      // A gate sign for a different set of columns, holding blocks of its own.
      var onlyOneColumn = new Gate(FENCE, new Pos(1, 66, 1), List.of(new Pos(1, 66, 1)));
      grid.sign(other, "[Gate]", Direction.NORTH)
          .bind(other, new Binding.GateFrame(onlyOneColumn, Optional.empty(), true))
          .stock(other, Stock.of(FENCE, 7));
      bound(grid, SIGN);

      assertThat(toggle(grid, SIGN)).isTrue();

      assertThat(resolved(grid, SIGN).keeper()).isEqualTo(SIGN);
      assertThat(grid.stockAt(SIGN)).isEqualTo(Stock.of(FENCE, 10));
      assertThat(grid.stockAt(other)).isEqualTo(Stock.of(FENCE, 7));
    }

    @Test
    void aMovedColumnTopRefusesRatherThanRetargeting() {
      var grid = gate();
      bound(grid, SIGN);
      grid.solid(new Pos(1, 67, 1), FENCE);

      assertThat(useRefusal(grid, SIGN)).isInstanceOf(StructureProblem.Changed.class);
    }

    @Test
    void aGateSignWithABridgeBindingIsNotSetUp() {
      var grid =
          gate().bind(SIGN, new Binding.SpanEnd(FENCE, new Pos(0, 66, 1), Optional.empty(), true));

      assertThat(useRefusal(grid, SIGN)).isEqualTo(new StructureProblem.NotBound());
    }

    @Test
    void aSecondSignForTheSameColumnsLinksAndSharesTheFirstsStock() {
      var grid = gate();
      bound(grid, SIGN);
      var back = new Pos(1, 64, 2);
      grid.sign(back, "[Gate]", Direction.SOUTH);

      var bind = bound(grid, back);

      assertThat(bind.writes()).extracting(StructureBinder.Write::sign).contains(SIGN, back);
      assertThat(resolved(grid, SIGN).keeper()).isEqualTo(SIGN);
      assertThat(resolved(grid, back).keeper()).isEqualTo(SIGN);
      var fences = grid.countAll(FENCE);
      assertThat(toggle(grid, back)).isTrue();
      assertThat(grid.stockAt(SIGN)).isEqualTo(Stock.of(FENCE, 10));
      assertThat(grid.stockAt(back)).isEqualTo(Stock.empty());
      assertThat(toggle(grid, SIGN)).isTrue();
      assertThat(grid.countAll(FENCE)).isEqualTo(fences);
    }

    @Test
    void aThirdSignForLinkedColumnsBindsAlone() {
      var grid = gate();
      bound(grid, SIGN);
      var back = new Pos(1, 64, 2);
      grid.sign(back, "[Gate]", Direction.SOUTH);
      bound(grid, back);
      var third = new Pos(-1, 64, 0);
      grid.sign(third, "[Gate]", Direction.NORTH);

      var bind = bound(grid, third);

      assertThat(bind.writes()).extracting(StructureBinder.Write::sign).containsExactly(third);
      assertThat(resolved(grid, third).keeper()).isEqualTo(third);
    }

    @Test
    void aRewrittenTwinIsMissing() {
      var grid = gate();
      bound(grid, SIGN);
      var back = new Pos(1, 64, 2);
      grid.sign(back, "[Gate]", Direction.SOUTH);
      bound(grid, back);
      grid.sign(SIGN, "[Gate]", Direction.NORTH);

      assertThat(useRefusal(grid, back)).isEqualTo(new StructureProblem.PartnerMissing(SIGN));
    }

    @Test
    void stackedColumnsNeverMergeAndLockTheGate() {
      // Two closed fence runs in one line, 61-62 and 64-66, one block apart.
      var grid = new TestGrid().fill(new Pos(-5, 60, -5), new Pos(5, 60, 5), STONE);
      grid.sign(SIGN, "[Gate]", Direction.NORTH);
      grid.fill(new Pos(0, 61, 1), new Pos(0, 62, 1), FENCE);
      grid.fill(new Pos(0, 64, 1), new Pos(0, 66, 1), FENCE);
      bound(grid, SIGN);
      var fences = grid.countAll(FENCE);

      for (var round = 0; round < 6; round++) {
        assertThat(toggle(grid, SIGN)).as("round %d", round).isTrue();
        assertThat(grid.countAll(FENCE) + grid.heldAll(FENCE)).isEqualTo(fences);
        assertThat(grid.cellAt(new Pos(0, 63, 1)).is(FENCE)).isFalse();
      }
    }
  }
}
