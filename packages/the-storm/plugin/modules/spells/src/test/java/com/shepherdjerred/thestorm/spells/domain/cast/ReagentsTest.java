package com.shepherdjerred.thestorm.spells.domain.cast;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class ReagentsTest {

  private static final ReagentCost COST =
      new ReagentCost(Map.of("REDSTONE", 15, "LAPIS_LAZULI", 5));

  @Test
  void shortfallNamesOnlyWhatIsMissing() {
    assertThat(COST.shortfall(Map.of("REDSTONE", 20, "LAPIS_LAZULI", 1)))
        .containsExactly(Map.entry("LAPIS_LAZULI", 4));
    assertThat(COST.shortfall(Map.of()))
        .containsOnly(Map.entry("LAPIS_LAZULI", 5), Map.entry("REDSTONE", 15));
    assertThat(COST.shortfall(Map.of("REDSTONE", 15, "LAPIS_LAZULI", 5, "DIRT", 1))).isEmpty();
    assertThat(COST.affordableWith(Map.of("REDSTONE", 15, "LAPIS_LAZULI", 5))).isTrue();
    assertThat(ReagentCost.free().affordableWith(Map.of())).isTrue();
  }

  @Test
  void amountsMustBePositiveAndBounded() {
    assertThatThrownBy(() -> new ReagentCost(Map.of("REDSTONE", 0)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new ReagentCost(Map.of("REDSTONE", ReagentCost.MAX_AMOUNT + 1)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new ReagentCost(Map.of(" ", 1)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void heldSumsStacksOfTheSameMaterial() {
    var stacks =
        List.of(
            new ReagentPlan.Stack(0, "REDSTONE", 10),
            new ReagentPlan.Stack(4, "REDSTONE", 64),
            new ReagentPlan.Stack(9, "LAPIS_LAZULI", 3));

    assertThat(ReagentPlan.held(stacks))
        .containsOnly(Map.entry("REDSTONE", 74), Map.entry("LAPIS_LAZULI", 3));
  }

  @Test
  void takesPayExactlyTheCostFromEarliestSlotsFirst() {
    var stacks =
        List.of(
            new ReagentPlan.Stack(2, "REDSTONE", 10),
            new ReagentPlan.Stack(3, "LAPIS_LAZULI", 64),
            new ReagentPlan.Stack(7, "REDSTONE", 64),
            new ReagentPlan.Stack(8, "REDSTONE", 64));

    assertThat(ReagentPlan.takes(COST, stacks))
        .containsExactly(
            new ReagentPlan.Take(2, 10), new ReagentPlan.Take(3, 5), new ReagentPlan.Take(7, 5));
  }

  @Test
  void takesRefuseAnInventoryThatCannotPay() {
    var stacks =
        List.of(
            new ReagentPlan.Stack(0, "REDSTONE", 14), new ReagentPlan.Stack(1, "LAPIS_LAZULI", 5));

    assertThatThrownBy(() -> ReagentPlan.takes(COST, stacks))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("REDSTONE");
  }

  @Test
  void aFreeCostTakesNothing() {
    assertThat(
            ReagentPlan.takes(ReagentCost.free(), List.of(new ReagentPlan.Stack(0, "REDSTONE", 1))))
        .isEmpty();
  }

  @Test
  void stacksAreNeverEmpty() {
    assertThatThrownBy(() -> new ReagentPlan.Stack(0, "REDSTONE", 0))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
