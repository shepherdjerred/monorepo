package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.qol.domain.grave.ItemBytes;
import org.bukkit.inventory.ItemStack;

/** Item stacks to and from Paper's versioned byte form, which survives server upgrades. */
final class ItemCodec {

  private ItemCodec() {}

  static ItemBytes encode(ItemStack stack) {
    return ItemBytes.of(stack.serializeAsBytes());
  }

  static ItemStack decode(ItemBytes bytes) {
    return ItemStack.deserializeBytes(bytes.bytes());
  }
}
