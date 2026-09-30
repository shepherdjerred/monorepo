package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.qol.domain.sort.SortOrder;
import java.util.ArrayList;
import java.util.List;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.jspecify.annotations.Nullable;

/**
 * Sorts an inventory in place: stacks in {@link SortOrder}, partial stacks of the same item merged,
 * packed from the first slot. Never creates or loses an item.
 */
final class InventorySorter {

  private InventorySorter() {}

  static void sort(Inventory inventory) {
    var contents = Blocks.storage(inventory);
    var stacks = new ArrayList<ItemStack>();
    for (var stack : contents) {
      if (stack != null && !stack.isEmpty()) {
        stacks.add(stack.clone());
      }
    }
    var keys = new ArrayList<SortOrder.Stack>();
    for (var i = 0; i < stacks.size(); i++) {
      var stack = stacks.get(i);
      keys.add(
          new SortOrder.Stack(stack.getType().key().asString(), name(stack), stack.getAmount(), i));
    }
    var total = count(stacks);
    var merged = new ArrayList<ItemStack>();
    for (var key : SortOrder.sort(keys)) {
      merge(merged, stacks.get(key.index()));
    }
    if (merged.size() > contents.length || count(merged) != total) {
      throw new IllegalStateException("sorting would change the items in " + inventory.getType());
    }
    @Nullable ItemStack[] sorted = new ItemStack[contents.length];
    for (var i = 0; i < merged.size(); i++) {
      sorted[i] = merged.get(i);
    }
    inventory.setStorageContents(sorted);
  }

  /** Adds {@code stack} to {@code merged}, topping up earlier stacks of the same item first. */
  private static void merge(List<ItemStack> merged, ItemStack stack) {
    for (var existing : merged) {
      if (stack.getAmount() == 0) {
        return;
      }
      var room = existing.getMaxStackSize() - existing.getAmount();
      if (room > 0 && existing.isSimilar(stack)) {
        var moved = Math.min(room, stack.getAmount());
        existing.setAmount(existing.getAmount() + moved);
        stack.setAmount(stack.getAmount() - moved);
      }
    }
    if (stack.getAmount() > 0) {
      merged.add(stack);
    }
  }

  private static long count(List<ItemStack> stacks) {
    return stacks.stream().mapToLong(ItemStack::getAmount).sum();
  }

  private static String name(ItemStack stack) {
    var meta = stack.getItemMeta();
    if (meta == null || !meta.hasCustomName()) {
      return "";
    }
    var name = meta.customName();
    return name == null ? "" : PlainTextComponentSerializer.plainText().serialize(name);
  }
}
