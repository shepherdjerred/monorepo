package com.shepherdjerred.thestorm.qol.domain.sort;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.qol.domain.sort.SortOrder.Stack;
import java.util.List;
import org.junit.jupiter.api.Test;

final class SortOrderTest {

  static List<Integer> order(Stack... stacks) {
    return SortOrder.sort(List.of(stacks)).stream().map(Stack::index).toList();
  }

  /** A stack whose category, block flag and color do not change the order. */
  static Stack stack(String material, String name, int amount, int index) {
    return new Stack(
        material, name, amount, index, 0, false, "", CategoryCatalog.UNCATEGORIZED_RANK);
  }

  @Test
  void stacksSortByItemTypeFirst() {
    assertThat(
            order(
                stack("minecraft:stone", "", 64, 0),
                stack("minecraft:apple", "", 3, 1),
                stack("minecraft:oak_log", "", 10, 2)))
        .containsExactly(1, 2, 0);
  }

  @Test
  void thenByNameWithUnnamedFirstAndCaseIgnored() {
    assertThat(
            order(
                stack("minecraft:diamond_sword", "zapper", 1, 0),
                stack("minecraft:diamond_sword", "", 1, 1),
                stack("minecraft:diamond_sword", "Excalibur", 1, 2),
                stack("minecraft:diamond_sword", "excalibur", 1, 3)))
        .containsExactly(1, 2, 3, 0);
  }

  @Test
  void thenFullestStackFirstThenOriginalOrder() {
    assertThat(
            order(
                stack("minecraft:dirt", "", 3, 0),
                stack("minecraft:dirt", "", 64, 1),
                stack("minecraft:dirt", "", 3, 2),
                stack("minecraft:dirt", "", 20, 3)))
        .containsExactly(1, 3, 0, 2);
  }

  @Test
  void anEmptyContainerStaysEmpty() {
    assertThat(SortOrder.sort(List.of())).isEmpty();
  }

  @Test
  void categoriesThenItemsThenNameThenColor() {
    assertThat(
            order(
                new Stack(
                    "minecraft:stone", "", 1, 0, 2, true, "", CategoryCatalog.UNCATEGORIZED_RANK),
                new Stack(
                    "minecraft:apple", "", 1, 1, 1, false, "", CategoryCatalog.UNCATEGORIZED_RANK),
                new Stack(
                    "minecraft:diamond_sword",
                    "",
                    1,
                    2,
                    0,
                    false,
                    "",
                    CategoryCatalog.UNCATEGORIZED_RANK),
                new Stack(
                    "minecraft:wool",
                    "",
                    1,
                    3,
                    2,
                    true,
                    "white",
                    CategoryCatalog.UNCATEGORIZED_RANK),
                new Stack(
                    "minecraft:wool",
                    "",
                    1,
                    4,
                    2,
                    true,
                    "red",
                    CategoryCatalog.UNCATEGORIZED_RANK)))
        .containsExactly(2, 1, 0, 4, 3);
  }
}
