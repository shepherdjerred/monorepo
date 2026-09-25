package com.shepherdjerred.thestorm.shops.domain.stock;

import static com.shepherdjerred.thestorm.shops.domain.stock.Slot.empty;
import static com.shepherdjerred.thestorm.shops.domain.stock.Slot.other;
import static com.shepherdjerred.thestorm.shops.domain.stock.Slot.same;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

final class StockTest {

  /** Applies a plan to a list of slots, as the adapter does to an inventory. */
  private static List<Slot> apply(List<Slot> slots, List<SlotChange> changes) {
    var result = new ArrayList<>(slots);
    for (var change : changes) {
      result.set(change.index(), change.amount() == 0 ? empty() : same(change.amount()));
    }
    return result;
  }

  private static List<SlotChange> ok(Result<List<SlotChange>, Stock.Shortfall> result) {
    return result.fold(
        value -> value,
        shortfall -> {
          throw new AssertionError("expected a plan, got " + shortfall);
        });
  }

  @Test
  void countsOnlyTheShopsItem() {
    assertThat(Stock.count(List.of(same(10), other(), empty(), same(64)))).isEqualTo(74);
    assertThat(Stock.count(List.of())).isZero();
    assertThat(Stock.count(List.of(other(), empty()))).isZero();
  }

  @ParameterizedTest
  @CsvSource({
    // max stack, expected space for [same(10), other, empty, same(64)]
    "64, 118",
    "16, 22",
    "1, 1",
  })
  void spaceTopsUpPartialStacksAndFillsEmptySlots(int maxStack, int expected) {
    var slots = List.of(same(10), other(), empty(), same(64));

    assertThat(Stock.space(slots, maxStack)).isEqualTo(expected);
  }

  @Test
  void oversizedStacksHaveNoRoomRatherThanNegativeRoom() {
    assertThat(Stock.space(List.of(same(99), empty()), 64)).isEqualTo(64);
  }

  @Test
  void spaceNeedsAPositiveStackSize() {
    assertThatThrownBy(() -> Stock.space(List.of(), 0))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void removalEmptiesTheSmallestStacksFirst() {
    var slots = List.of(same(64), same(5), other(), same(20), same(5));

    var plan = ok(Stock.planRemoval(slots, 30));

    assertThat(plan)
        .containsExactly(new SlotChange(1, 0), new SlotChange(4, 0), new SlotChange(3, 0));
    assertThat(Stock.count(apply(slots, plan))).isEqualTo(64);
  }

  @Test
  void removalLeavesAPartialStackWhenItStopsMidStack() {
    var slots = List.of(same(64), same(10));

    var plan = ok(Stock.planRemoval(slots, 16));

    assertThat(plan).containsExactly(new SlotChange(1, 0), new SlotChange(0, 58));
    assertThat(apply(slots, plan)).containsExactly(same(58), empty());
  }

  @Test
  void removalOfEverythingEmptiesEverySlot() {
    var slots = List.of(same(3), other(), same(4));

    var plan = ok(Stock.planRemoval(slots, 7));

    assertThat(apply(slots, plan)).containsExactly(empty(), other(), empty());
  }

  @Test
  void removalRefusesMoreThanIsHeld() {
    assertThat(Stock.planRemoval(List.of(same(3), other()), 4))
        .isEqualTo(Result.err(new Stock.Shortfall(3, 4)));
  }

  @Test
  void insertionTopsUpPartialStacksBeforeUsingEmptySlots() {
    var slots = List.of(empty(), same(60), other(), same(10), empty());

    var plan = ok(Stock.planInsertion(slots, 70, 64));

    assertThat(plan)
        .containsExactly(new SlotChange(1, 64), new SlotChange(3, 64), new SlotChange(0, 12));
    assertThat(apply(slots, plan)).containsExactly(same(12), same(64), other(), same(64), empty());
  }

  @Test
  void insertionSplitsIntoStacksOfTheItemsMaximum() {
    var slots = List.of(empty(), empty(), empty());

    var plan = ok(Stock.planInsertion(slots, 40, 16));

    assertThat(apply(slots, plan)).containsExactly(same(16), same(16), same(8));
  }

  @Test
  void unstackableItemsTakeOneSlotEach() {
    var slots = List.of(empty(), same(1), empty(), empty());

    var plan = ok(Stock.planInsertion(slots, 3, 1));

    assertThat(apply(slots, plan)).containsExactly(same(1), same(1), same(1), same(1));
    assertThat(Stock.planInsertion(slots, 4, 1)).isEqualTo(Result.err(new Stock.Shortfall(3, 4)));
  }

  @Test
  void insertionRefusesMoreThanFits() {
    assertThat(Stock.planInsertion(List.of(same(60), other()), 5, 64))
        .isEqualTo(Result.err(new Stock.Shortfall(4, 5)));
  }

  @Test
  void plansNeedAPositiveQuantity() {
    assertThatThrownBy(() -> Stock.planRemoval(List.of(), 0))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Stock.planInsertion(List.of(), -1, 64))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void aPlanNeverCreatesOrLosesItems() {
    var slots = List.of(same(7), empty(), same(63), other(), same(1), empty());
    for (var quantity = 1; quantity <= Stock.count(slots); quantity++) {
      var after = apply(slots, ok(Stock.planRemoval(slots, quantity)));
      assertThat(Stock.count(after)).isEqualTo(Stock.count(slots) - quantity);
    }
    for (var quantity = 1; quantity <= Stock.space(slots, 64); quantity++) {
      var after = apply(slots, ok(Stock.planInsertion(slots, quantity, 64)));
      assertThat(Stock.count(after)).isEqualTo(Stock.count(slots) + quantity);
      assertThat(after.get(3)).isEqualTo(other());
    }
  }

  @Test
  void slotsAndChangesValidateThemselves() {
    assertThatThrownBy(() -> same(0)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new SlotChange(-1, 0)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new SlotChange(0, -1)).isInstanceOf(IllegalArgumentException.class);
  }
}
