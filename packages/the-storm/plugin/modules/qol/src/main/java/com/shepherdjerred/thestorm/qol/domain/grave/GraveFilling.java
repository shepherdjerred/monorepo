package com.shepherdjerred.thestorm.qol.domain.grave;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.OptionalInt;

/**
 * Turns a death's drops into grave stacks, remembering which inventory slot each came from so the
 * owner gets armor, offhand and hotbar back in place. A drop that matches no slot (the drop list
 * can hold items other plugins added) gets no slot.
 */
public final class GraveFilling {

  private GraveFilling() {}

  /**
   * The grave stacks for {@code drops}, indexed in drop order.
   *
   * @param drops the stacks that would have dropped
   * @param inventory the inventory at death, by slot, holding only non-empty slots
   */
  public static List<GraveItem> fill(List<ItemBytes> drops, Map<Integer, ItemBytes> inventory) {
    var slots = new ArrayList<>(inventory.keySet());
    slots.sort(Integer::compare);
    var used = new HashSet<Integer>();
    var items = new ArrayList<GraveItem>();
    for (var index = 0; index < drops.size(); index++) {
      var drop = drops.get(index);
      var slot = OptionalInt.empty();
      for (var candidate : slots) {
        if (!used.contains(candidate) && drop.equals(inventory.get(candidate))) {
          used.add(candidate);
          slot = OptionalInt.of(candidate);
          break;
        }
      }
      items.add(new GraveItem(index, slot, drop));
    }
    return List.copyOf(items);
  }
}
