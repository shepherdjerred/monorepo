package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.qol.domain.sort.CategoryCatalog;
import com.shepherdjerred.thestorm.qol.domain.sort.ItemColors;
import com.shepherdjerred.thestorm.qol.domain.sort.SortOrder;
import java.util.ArrayList;
import java.util.List;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;
import org.jspecify.annotations.Nullable;

/**
 * Sorts an inventory in place: stacks in {@link SortOrder}, partial stacks of the same item merged,
 * packed from the first slot. Never creates or loses an item.
 */
final class InventorySorter {

  private static @Nullable CategoryCatalog catalog;

  private InventorySorter() {}

  /** Installs the category files. Sorting before this is a wiring bug. */
  static void use(CategoryCatalog installed) {
    catalog = installed;
  }

  static void sort(Inventory inventory) {
    var contents = Blocks.storage(inventory);
    inventory.setStorageContents(arrange(contents));
  }

  /**
   * Sorts slots {@code from} through {@code to} of a player's storage. Armor and offhand are not in
   * that range. Slots outside it stay where they are.
   */
  static void sortRange(PlayerInventory inventory, int from, int to) {
    if (from < 0 || to < from || to > 35) {
      throw new IllegalArgumentException(
          "player storage slots are 0 through 35: " + from + ".." + to);
    }
    var count = to - from + 1;
    @Nullable ItemStack[] slice = new ItemStack[count];
    for (var i = 0; i < count; i++) {
      var stack = inventory.getItem(from + i);
      slice[i] = stack == null || stack.isEmpty() ? null : stack.clone();
    }
    var sorted = arrange(slice);
    for (var i = 0; i < count; i++) {
      inventory.setItem(from + i, sorted[i]);
    }
  }

  private static @Nullable ItemStack[] arrange(@Nullable ItemStack[] contents) {
    var installed = catalog;
    if (installed == null) {
      throw new IllegalStateException("sort categories are not loaded");
    }
    var stacks = new ArrayList<ItemStack>();
    for (var stack : contents) {
      if (stack != null && !stack.isEmpty()) {
        stacks.add(stack.clone());
      }
    }
    var keys = new ArrayList<SortOrder.Stack>();
    for (var i = 0; i < stacks.size(); i++) {
      var stack = stacks.get(i);
      var key = stack.getType().key().asString();
      var placed = installed.place(key);
      keys.add(
          new SortOrder.Stack(
              key,
              name(stack),
              stack.getAmount(),
              i,
              placed.category(),
              stack.getType().isBlock(),
              ItemColors.of(key),
              placed.stickyRank()));
    }
    var total = count(stacks);
    var merged = new ArrayList<ItemStack>();
    for (var key : SortOrder.sort(keys)) {
      merge(merged, stacks.get(key.index()));
    }
    if (merged.size() > contents.length || count(merged) != total) {
      throw new IllegalStateException("sorting would change how many items there are");
    }
    @Nullable ItemStack[] sorted = new ItemStack[contents.length];
    for (var i = 0; i < merged.size(); i++) {
      sorted[i] = merged.get(i);
    }
    return sorted;
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
