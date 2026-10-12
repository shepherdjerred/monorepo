package com.shepherdjerred.thestorm.essentials.app;

import java.util.List;

/** Serialized copies of the ordinary starter kit, including its names and books. */
public record StarterSupplies(List<String> items) {
  public StarterSupplies {
    items = List.copyOf(items);
    if (items.size() > 36) throw new IllegalArgumentException("starter kit exceeds player storage");
  }
}
