package com.shepherdjerred.thestorm.shops.domain.stock;

import static java.util.Comparator.comparingInt;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.IntStream;

/**
 * Counts and moves one item through a list of slots. Plans are exact slot writes, so the adapter
 * applies them without re-deriving anything and a plan never creates or loses an item.
 */
public final class Stock {

  private Stock() {}

  /**
   * Too few items, or too little room, for a plan.
   *
   * @param available what there is
   * @param needed what the plan asked for
   */
  public record Shortfall(int available, int needed) {}

  /** How many of the item the slots hold. */
  public static int count(List<Slot> slots) {
    var total = 0;
    for (var slot : slots) {
      if (slot instanceof Slot.Same(var amount)) {
        total = Math.addExact(total, amount);
      }
    }
    return total;
  }

  /** How many more of the item fit, topping up partial stacks and filling empty slots. */
  public static int space(List<Slot> slots, int maxStack) {
    requireMaxStack(maxStack);
    var total = 0;
    for (var slot : slots) {
      total = Math.addExact(total, roomIn(slot, maxStack));
    }
    return total;
  }

  /**
   * Takes {@code quantity} items, emptying the smallest stacks first so full stacks stay whole.
   * Ties go to the earlier slot.
   */
  public static Result<List<SlotChange>, Shortfall> planRemoval(List<Slot> slots, int quantity) {
    requireQuantity(quantity);
    var available = count(slots);
    if (available < quantity) {
      return Result.err(new Shortfall(available, quantity));
    }
    var order =
        IntStream.range(0, slots.size())
            .filter(index -> slots.get(index) instanceof Slot.Same)
            .boxed()
            // A stable sort: equal stacks keep slot order.
            .sorted(comparingInt((Integer index) -> amountIn(slots.get(index))))
            .toList();
    var changes = new ArrayList<SlotChange>();
    var remaining = quantity;
    for (var index : order) {
      if (remaining == 0) {
        break;
      }
      var amount = amountIn(slots.get(index));
      var taken = Math.min(amount, remaining);
      changes.add(new SlotChange(index, amount - taken));
      remaining -= taken;
    }
    return Result.ok(List.copyOf(changes));
  }

  /** Adds {@code quantity} items: partial stacks first, then empty slots, each in slot order. */
  public static Result<List<SlotChange>, Shortfall> planInsertion(
      List<Slot> slots, int quantity, int maxStack) {
    requireQuantity(quantity);
    var room = space(slots, maxStack);
    if (room < quantity) {
      return Result.err(new Shortfall(room, quantity));
    }
    // Partial stacks first, then empty slots; each group in slot order.
    var order =
        IntStream.concat(
            IntStream.range(0, slots.size()).filter(index -> slots.get(index) instanceof Slot.Same),
            IntStream.range(0, slots.size())
                .filter(index -> slots.get(index) instanceof Slot.Empty));
    var changes = new ArrayList<SlotChange>();
    var remaining = quantity;
    for (var index : order.toArray()) {
      var slot = slots.get(index);
      var added = Math.min(roomIn(slot, maxStack), remaining);
      if (added > 0) {
        changes.add(new SlotChange(index, amountIn(slot) + added));
        remaining -= added;
      }
    }
    return Result.ok(List.copyOf(changes));
  }

  private static int roomIn(Slot slot, int maxStack) {
    return switch (slot) {
      case Slot.Empty() -> maxStack;
      case Slot.Same(var amount) -> Math.max(0, maxStack - amount);
      case Slot.Other() -> 0;
    };
  }

  private static int amountIn(Slot slot) {
    return slot instanceof Slot.Same(var amount) ? amount : 0;
  }

  private static void requireQuantity(int quantity) {
    if (quantity < 1) {
      throw new IllegalArgumentException("quantity must be positive: " + quantity);
    }
  }

  private static void requireMaxStack(int maxStack) {
    if (maxStack < 1) {
      throw new IllegalArgumentException("max stack size must be positive: " + maxStack);
    }
  }
}
