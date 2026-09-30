package com.shepherdjerred.thestorm.quests.domain.engine;

import java.util.List;

/** How many items one craft click makes. */
public final class CraftCount {

  private CraftCount() {}

  /**
   * Items made by a craft click: one result for a plain click; for a shift-click, as many crafts as
   * the smallest ingredient stack allows, capped by how many results fit in the inventory.
   *
   * @param shift whether the click was a shift-click
   * @param perCraft items one craft makes
   * @param ingredients the amounts in each non-empty crafting slot
   * @param room how many results fit in the inventory
   */
  public static int of(boolean shift, int perCraft, List<Integer> ingredients, int room) {
    if (perCraft < 1 || ingredients.isEmpty()) {
      return 0;
    }
    if (!shift) {
      return perCraft;
    }
    var crafts = ingredients.stream().mapToInt(Integer::intValue).min().orElse(0);
    var fitting = room / perCraft;
    return Math.max(0, Math.min(crafts, fitting)) * perCraft;
  }
}
