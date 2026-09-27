package com.shepherdjerred.thestorm.qol.domain.grave;

import java.util.OptionalInt;

/**
 * One stack in a grave.
 *
 * @param index the stack's position among the grave's stacks, unique within the grave
 * @param slot the inventory slot the stack was in when its owner died, so the owner gets armor and
 *     hotbar back where they were; empty for drops that were in no slot
 * @param item the serialized stack
 */
public record GraveItem(int index, OptionalInt slot, ItemBytes item) {

  public GraveItem {
    if (index < 0) {
      throw new IllegalArgumentException("index must not be negative: " + index);
    }
    if (slot.isPresent() && slot.getAsInt() < 0) {
      throw new IllegalArgumentException("slot must not be negative: " + slot);
    }
  }
}
