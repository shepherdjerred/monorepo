package com.shepherdjerred.thestorm.shops.domain.stock;

/** One inventory slot, as seen by a shop trading a single item. */
public sealed interface Slot {

  /** Nothing in the slot. */
  record Empty() implements Slot {}

  /**
   * The shop's item, {@code amount} of it.
   *
   * @param amount how many; may exceed the normal stack size for oversized stacks
   */
  record Same(int amount) implements Slot {
    public Same {
      if (amount < 1) {
        throw new IllegalArgumentException("a filled slot holds at least one item: " + amount);
      }
    }
  }

  /** Some other item, which the shop never touches. */
  record Other() implements Slot {}

  static Slot empty() {
    return new Empty();
  }

  static Slot same(int amount) {
    return new Same(amount);
  }

  static Slot other() {
    return new Other();
  }
}
