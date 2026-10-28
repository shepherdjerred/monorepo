package com.shepherdjerred.thestorm.qol.domain.sort;

import static java.util.Comparator.comparingInt;

import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/**
 * The order a sorted container's stacks end up in: by category, then items before blocks, then item
 * type, dye color, custom name (unnamed first), fullest stack, and the original order among equals.
 * A sticky category uses its file order before the item type.
 */
public final class SortOrder {

  /**
   * One stack.
   *
   * @param material the item type's key, such as {@code minecraft:oak_log}
   * @param name the stack's custom name as plain text, or empty
   * @param amount how many items
   * @param index where the stack was before sorting
   * @param category lower sorts first; unmatched items share one rank after the real categories
   * @param block whether the item is a block; items sort before blocks
   * @param color the dye color, or empty
   * @param stickyRank line order inside a sticky category, or {@link
   *     CategoryCatalog#UNCATEGORIZED_RANK} when the category does not pin order
   */
  public record Stack(
      String material,
      String name,
      int amount,
      int index,
      int category,
      boolean block,
      String color,
      int stickyRank) {}

  private static final Comparator<Stack> ORDER =
      comparingInt(Stack::category)
          .thenComparingInt(Stack::stickyRank)
          .thenComparing(Stack::block)
          .thenComparing(Stack::material)
          .thenComparing(Stack::color)
          .thenComparing(stack -> stack.name().toLowerCase(Locale.ROOT))
          .thenComparing(Stack::name)
          .thenComparing(comparingInt(Stack::amount).reversed())
          .thenComparingInt(Stack::index);

  private SortOrder() {}

  /** {@code stacks} in sorted order. */
  public static List<Stack> sort(List<Stack> stacks) {
    return stacks.stream().sorted(ORDER).toList();
  }
}
