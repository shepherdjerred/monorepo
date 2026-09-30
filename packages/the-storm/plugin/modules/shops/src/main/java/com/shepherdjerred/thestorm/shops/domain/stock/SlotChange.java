package com.shepherdjerred.thestorm.shops.domain.stock;

/**
 * Sets one slot to hold {@code amount} of the shop's item; zero empties it.
 *
 * @param index the slot index in the inventory's contents
 * @param amount the new amount
 */
public record SlotChange(int index, int amount) {

  public SlotChange {
    if (index < 0 || amount < 0) {
      throw new IllegalArgumentException("index and amount must not be negative");
    }
  }
}
