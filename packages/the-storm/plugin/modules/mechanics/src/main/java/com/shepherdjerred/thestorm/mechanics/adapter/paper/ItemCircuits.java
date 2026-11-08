/* CraftBook item IC ports, GNU GPL version 3 or later.
 * Upstream revision and original copyright notice: NOTICE and IntegratedCircuits.
 */
package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.ReservedContainers;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.bukkit.Keyed;
import org.bukkit.Material;
import org.bukkit.block.Container;
import org.bukkit.block.data.Directional;
import org.bukkit.entity.Item;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

/** MC1219, MC1220 and MC1229; inventories and original sample items are the definitions. */
final class ItemCircuits {
  private final CircuitAccess access;

  ItemCircuits(CircuitAccess access) {
    this.access = access;
  }

  boolean breakBlock(CircuitAccess.Visit visit) {
    var target = visit.storage();
    if (!access.may(visit, target, ProtectedAction.AUTOMATIC_BREAK)
        || target.getType().isAir()
        || target.getType() == Material.BEDROCK
        || target.getType() == Material.MOVING_PISTON
        || (!visit.line(2).isBlank() && target.getType() != CircuitAccess.material(visit.line(2)))
        || access
            .context()
            .services()
            .find(ReservedContainers.class)
            .filter(reserved -> reserved.contains(target.getLocation()))
            .isPresent()) return false;
    var drops = new ArrayList<>(target.getDrops());
    if (target.getState(false) instanceof Container container) {
      if (!access.may(visit, target, ProtectedAction.OPEN_CONTAINER, ProtectedAction.REMOVE_ITEM))
        return false;
      var inventory =
          container instanceof org.bukkit.block.Chest chest
              ? chest.getBlockInventory()
              : container.getInventory();
      for (var item : java.util.Objects.requireNonNull(inventory.getStorageContents())) {
        if (item != null && !item.getType().isAir()) drops.add(item.clone());
      }
    }
    access.set(visit, target, Material.AIR.createBlockData());
    access.collect(visit, drops);
    return true;
  }

  boolean craft(CircuitAccess.Visit visit) {
    var block = visit.storage();
    var found = access.inventory(visit, block);
    if (found.isEmpty()
        || (block.getType() != Material.DISPENSER && block.getType() != Material.DROPPER))
      return false;
    var inventory = found.orElseThrow();
    collectIngredients(visit, inventory);
    var contents = java.util.Objects.requireNonNull(inventory.getStorageContents());
    if (Arrays.stream(contents)
        .filter(item -> item != null && !item.getType().isAir())
        .anyMatch(item -> item.getAmount() < 2)) return false;
    var server = access.context().plugin().getServer();
    var recipe = server.getCraftingRecipe(contents, block.getWorld());
    // Player-only custom recipes retain their own unlock and permission checks.
    if (!(recipe instanceof Keyed keyed) || !keyed.getKey().getNamespace().equals("minecraft"))
      return false;
    var crafted = server.craftItemResult(contents, block.getWorld());
    if (crafted.getResult().getType().isAir()) return false;
    inventory.setStorageContents(crafted.getResultingMatrix());
    var output = block.getRelative(((Directional) block.getBlockData()).getFacing());
    access.emit(visit, output, List.of(crafted.getResult()));
    return true;
  }

  private void collectIngredients(CircuitAccess.Visit visit, Inventory inventory) {
    for (var entity :
        visit
            .block()
            .getWorld()
            .getNearbyEntities(visit.block().getLocation().toCenterLocation(), 1, 1, 1)) {
      if (!(entity instanceof Item dropped)
          || !access.may(visit, dropped.getLocation().getBlock(), ProtectedAction.REMOVE_ITEM))
        continue;
      var stack = dropped.getItemStack();
      var remaining = fillSamples(inventory, stack);
      if (remaining == 0) dropped.remove();
      else if (remaining != stack.getAmount()) dropped.setItemStack(stack.asQuantity(remaining));
    }
  }

  private static int fillSamples(Inventory inventory, ItemStack stack) {
    var remaining = stack.getAmount();
    while (remaining > 0) {
      var smallest = smallestSample(inventory, stack);
      if (smallest < 0) break;
      var item = java.util.Objects.requireNonNull(inventory.getItem(smallest));
      inventory.setItem(smallest, item.asQuantity(item.getAmount() + 1));
      remaining--;
    }
    return remaining;
  }

  private static int smallestSample(Inventory inventory, ItemStack stack) {
    var smallest = -1;
    for (var slot = 0; slot < inventory.getSize(); slot++) {
      var item = inventory.getItem(slot);
      if (item != null
          && item.isSimilar(stack)
          && item.getAmount() < item.getMaxStackSize()
          && (smallest < 0
              || item.getAmount()
                  < java.util.Objects.requireNonNull(inventory.getItem(smallest)).getAmount()))
        smallest = slot;
    }
    return smallest;
  }

  boolean sort(CircuitAccess.Visit visit) {
    var samples = access.inventory(visit, visit.storage());
    var changed = false;
    for (var entity :
        visit
            .block()
            .getWorld()
            .getNearbyEntities(visit.block().getLocation().toCenterLocation(), 1, 1, 1)) {
      if (!(entity instanceof Item dropped)
          || !access.may(visit, dropped.getLocation().getBlock(), ProtectedAction.REMOVE_ITEM))
        continue;
      changed |= sort(visit, dropped, samples);
    }
    return changed;
  }

  private boolean sort(
      CircuitAccess.Visit visit, Item dropped, java.util.Optional<Inventory> samples) {
    var stack = dropped.getItemStack();
    var matches = samples.isPresent() && samples.orElseThrow().containsAtLeast(stack.asOne(), 1);
    var right = matches ^ visit.line(2).equalsIgnoreCase("invert");
    var destination =
        visit.support().getRelative(right ? visit.left().getOppositeFace() : visit.left());
    if (!access.may(visit, destination, ProtectedAction.INSERT_ITEM)) return false;
    var inventory = access.inventory(visit, destination);
    if (inventory.isPresent()) {
      var left = inventory.orElseThrow().addItem(stack.clone());
      if (left.isEmpty()) dropped.remove();
      else dropped.setItemStack(left.values().iterator().next());
    } else dropped.teleport(destination.getLocation().toCenterLocation());
    return true;
  }
}
