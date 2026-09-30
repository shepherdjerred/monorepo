package com.shepherdjerred.thestorm.qol.domain.sort;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.qol.domain.sort.SortOrder.Stack;
import java.util.List;
import org.junit.jupiter.api.Test;

final class SortOrderTest {

  static List<Integer> order(Stack... stacks) {
    return SortOrder.sort(List.of(stacks)).stream().map(Stack::index).toList();
  }

  @Test
  void stacksSortByItemTypeFirst() {
    assertThat(
            order(
                new Stack("minecraft:stone", "", 64, 0),
                new Stack("minecraft:apple", "", 3, 1),
                new Stack("minecraft:oak_log", "", 10, 2)))
        .containsExactly(1, 2, 0);
  }

  @Test
  void thenByNameWithUnnamedFirstAndCaseIgnored() {
    assertThat(
            order(
                new Stack("minecraft:diamond_sword", "zapper", 1, 0),
                new Stack("minecraft:diamond_sword", "", 1, 1),
                new Stack("minecraft:diamond_sword", "Excalibur", 1, 2),
                new Stack("minecraft:diamond_sword", "excalibur", 1, 3)))
        .containsExactly(1, 2, 3, 0);
  }

  @Test
  void thenFullestStackFirstThenOriginalOrder() {
    assertThat(
            order(
                new Stack("minecraft:dirt", "", 3, 0),
                new Stack("minecraft:dirt", "", 64, 1),
                new Stack("minecraft:dirt", "", 3, 2),
                new Stack("minecraft:dirt", "", 20, 3)))
        .containsExactly(1, 3, 0, 2);
  }

  @Test
  void anEmptyContainerStaysEmpty() {
    assertThat(SortOrder.sort(List.of())).isEmpty();
  }
}
