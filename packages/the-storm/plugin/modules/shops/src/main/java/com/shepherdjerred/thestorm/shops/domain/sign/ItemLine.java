package com.shepherdjerred.thestorm.shops.domain.sign;

/** The item a sign trades, read from its last line. */
public sealed interface ItemLine {

  /** The marker for "I'll show you": the owner sets the item by clicking the sign holding it. */
  String PENDING_MARKER = "?";

  /** {@code ?}: the owner will click the sign with the item, so enchanted or named items work. */
  record Pending() implements ItemLine {}

  /**
   * An item written by name, such as {@code Diamond Sword} or {@code oak_log}.
   *
   * @param name the text as written, trimmed
   */
  record Named(String name) implements ItemLine {
    public Named {
      if (name.isBlank()) {
        throw new IllegalArgumentException("an item name must not be blank");
      }
    }
  }
}
