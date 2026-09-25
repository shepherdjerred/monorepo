package com.shepherdjerred.thestorm.spells.adapter.paper;

import com.shepherdjerred.thestorm.spells.domain.cast.ReagentCost;
import com.shepherdjerred.thestorm.spells.domain.cast.ReagentPlan;
import java.util.ArrayList;
import java.util.List;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;

/**
 * Reagents in a player's inventory (hotbar and backpack). Only plain stacks count: a renamed,
 * enchanted or plugin item (a spell scroll, a Storm Shard) is never spent as a reagent.
 */
final class Reagents {

  /** Slots 0-35: the hotbar and backpack. */
  private static final int STORAGE_SLOTS = 36;

  private Reagents() {}

  /** The plain stacks of the materials {@code cost} names. */
  static List<ReagentPlan.Stack> stacks(PlayerInventory inventory, ReagentCost cost) {
    var stacks = new ArrayList<ReagentPlan.Stack>();
    for (var slot = 0; slot < STORAGE_SLOTS; slot++) {
      var item = inventory.getItem(slot);
      if (item == null || item.isEmpty()) {
        continue;
      }
      var material = item.getType().name();
      if (cost.amounts().containsKey(material) && isPlain(item)) {
        stacks.add(new ReagentPlan.Stack(slot, material, item.getAmount()));
      }
    }
    return stacks;
  }

  private static boolean isPlain(ItemStack item) {
    return item.isSimilar(ItemStack.of(item.getType()));
  }

  /** Removes {@code cost} from {@code inventory}; the caller has checked it can pay. */
  static void take(PlayerInventory inventory, ReagentCost cost) {
    for (var take : ReagentPlan.takes(cost, stacks(inventory, cost))) {
      var item = inventory.getItem(take.slot());
      if (item == null) {
        throw new IllegalStateException("reagent slot " + take.slot() + " emptied mid-cast");
      }
      var left = item.getAmount() - take.amount();
      inventory.setItem(take.slot(), left == 0 ? null : item.asQuantity(left));
    }
  }
}
