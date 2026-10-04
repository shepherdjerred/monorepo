package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.towns.domain.land.Land;
import com.shepherdjerred.thestorm.towns.domain.parcel.ProtectedParcel;
import java.util.Objects;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryAction;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.inventory.Inventory;

/** An already-open container cannot race a snapshot or placement journal. */
final class ParcelInventoryListener implements Listener {
  private final Guard guard;

  ParcelInventoryListener(Guard guard) {
    this.guard = guard;
  }

  @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
  void onClick(InventoryClickEvent event) {
    if (event.getWhoClicked() instanceof Player player) {
      var top = event.getView().getTopInventory();
      if (frozen(top, player) || (withdrawalOnly(top, player) && addsItemsToTop(event, top))) {
        event.setCancelled(true);
      }
    }
  }

  @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
  void onDrag(InventoryDragEvent event) {
    if (event.getWhoClicked() instanceof Player player) {
      var top = event.getView().getTopInventory();
      if (frozen(top, player)
          || (withdrawalOnly(top, player)
              && event.getRawSlots().stream().anyMatch(slot -> slot < top.getSize()))) {
        event.setCancelled(true);
      }
    }
  }

  private boolean addsItemsToTop(InventoryClickEvent event, Inventory top) {
    return addsItemsToTop(event.getAction(), Objects.equals(event.getClickedInventory(), top));
  }

  static boolean addsItemsToTop(InventoryAction action, boolean clickedTop) {
    if (action == InventoryAction.MOVE_TO_OTHER_INVENTORY) {
      return !clickedTop;
    }
    return clickedTop
        && switch (action) {
          case PLACE_ALL,
              PLACE_ONE,
              PLACE_SOME,
              SWAP_WITH_CURSOR,
              HOTBAR_SWAP,
              HOTBAR_MOVE_AND_READD ->
              true;
          default -> false;
        };
  }

  private boolean frozen(Inventory inventory, Player player) {
    for (var location : Chests.locations(inventory)) {
      var land = guard.land(location);
      if (land instanceof Land.WorkLand) {
        return true;
      }
      if (land instanceof Land.ParcelLand(var parcel)
          && (parcel.phase() == ProtectedParcel.Phase.RESETTING
              || parcel.phase() == ProtectedParcel.Phase.UNOWNED
              || !parcel.owners().contains(player.getUniqueId()))) {
        return true;
      }
    }
    return false;
  }

  private boolean withdrawalOnly(Inventory inventory, Player player) {
    for (var location : Chests.locations(inventory)) {
      if (guard.land(location) instanceof Land.ParcelLand(var parcel)
          && parcel.phase() == ProtectedParcel.Phase.GRACE
          && parcel.owners().contains(player.getUniqueId())) {
        return true;
      }
    }
    return false;
  }

  @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
  void onCook(org.bukkit.event.block.BlockCookEvent event) {
    if (worldFrozen(event.getBlock())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
  void onBurn(org.bukkit.event.inventory.FurnaceBurnEvent event) {
    if (worldFrozen(event.getBlock())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
  void onBrew(org.bukkit.event.inventory.BrewEvent event) {
    if (worldFrozen(event.getBlock())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
  void onBrewFuel(org.bukkit.event.inventory.BrewingStandFuelEvent event) {
    if (worldFrozen(event.getBlock())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
  void onCraft(org.bukkit.event.block.CrafterCraftEvent event) {
    if (worldFrozen(event.getBlock())) {
      event.setCancelled(true);
    }
  }

  private boolean worldFrozen(org.bukkit.block.Block block) {
    var land = guard.land(block);
    return land instanceof Land.WorkLand
        || (land instanceof Land.ParcelLand(var parcel)
            && parcel.phase() != ProtectedParcel.Phase.ACTIVE);
  }
}
