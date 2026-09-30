package com.shepherdjerred.thestorm.qol.domain.sort;

import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/**
 * The order a sorted container's stacks end up in: by item type, then by custom name (unnamed
 * first), then fullest stack first, keeping the original order among equals.
 */
public final class SortOrder {

  /**
   * One stack.
   *
   * @param material the item type's key, such as {@code minecraft:oak_log}
   * @param name the stack's custom name as plain text, or empty
   * @param amount how many items
   * @param index where the stack was before sorting
   */
  public record Stack(String material, String name, int amount, int index) {}

  private static final Comparator<Stack> ORDER =
      Comparator.comparing(Stack::material)
          .thenComparing(stack -> stack.name().toLowerCase(Locale.ROOT))
          .thenComparing(Stack::name)
          .thenComparing(Comparator.comparingInt(Stack::amount).reversed())
          .thenComparingInt(Stack::index);

  private SortOrder() {}

  /** {@code stacks} in sorted order. */
  public static List<Stack> sort(List<Stack> stacks) {
    return stacks.stream().sorted(ORDER).toList();
  }
}
