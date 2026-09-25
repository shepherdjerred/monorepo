package com.shepherdjerred.thestorm.spells.domain.cast;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Accounting for reagents in an inventory: how many of each material a player holds, and exactly
 * which slots to take from to pay a {@link ReagentCost}. Plain stacks only; the adapter never
 * offers renamed, enchanted or plugin items as reagents.
 */
public final class ReagentPlan {

  private ReagentPlan() {}

  /**
   * One inventory slot holding a plain reagent stack.
   *
   * @param slot the inventory slot index
   * @param material the material name
   * @param amount how many the stack holds
   */
  public record Stack(int slot, String material, int amount) {
    public Stack {
      if (amount < 1) {
        throw new IllegalArgumentException("a stack holds at least one item: " + amount);
      }
    }
  }

  /**
   * Take {@code amount} items from {@code slot}.
   *
   * @param slot the inventory slot index
   * @param amount how many to remove, at most the stack's size
   */
  public record Take(int slot, int amount) {}

  /** The total held of each material among {@code stacks}. */
  public static Map<String, Integer> held(List<Stack> stacks) {
    var held = new HashMap<String, Integer>();
    for (var stack : stacks) {
      held.merge(stack.material(), stack.amount(), Integer::sum);
    }
    return held;
  }

  /**
   * The slots to take from to pay {@code cost}, earliest slots first.
   *
   * @throws IllegalStateException if {@code stacks} cannot pay (callers check {@link
   *     ReagentCost#shortfall} first)
   */
  public static List<Take> takes(ReagentCost cost, List<Stack> stacks) {
    var owed = new HashMap<>(cost.amounts());
    var takes = new ArrayList<Take>();
    for (var stack : stacks) {
      var due = owed.getOrDefault(stack.material(), 0);
      if (due == 0) {
        continue;
      }
      var taken = Math.min(due, stack.amount());
      takes.add(new Take(stack.slot(), taken));
      owed.put(stack.material(), due - taken);
    }
    owed.values().removeIf(amount -> amount == 0);
    if (!owed.isEmpty()) {
      throw new IllegalStateException("stacks cannot pay " + owed);
    }
    return takes;
  }
}
