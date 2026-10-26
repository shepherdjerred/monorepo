package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.arena.app.ArenaPresence;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.qol.app.QolStore;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import net.kyori.adventure.text.Component;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;
import org.bukkit.persistence.PersistentDataType;
import org.jspecify.annotations.Nullable;

/** Durable entitlement, with one reserved hotbar slot and no replacement of ordinary items. */
final class StarterCompass {
  static final int SLOT = 8;
  private static final NamespacedKey OWNER = new NamespacedKey("thestorm", "starter_rtp_owner");
  private final Map<UUID, Integer> charges = new HashMap<>();
  private final ModuleContext context;
  private final QolStore store;
  private final SealedWorlds sealed;

  StarterCompass(ModuleContext context, QolStore store, SealedWorlds sealed) {
    this.context = context;
    this.store = store;
    this.sealed = sealed;
  }

  void loaded(Player player, int remaining) {
    if (remaining > 0) charges.put(player.getUniqueId(), remaining);
    else charges.remove(player.getUniqueId());
    reconcile(player);
  }

  boolean pending(Player player) {
    return manages(player) && remaining(player) > 0;
  }

  int remaining(Player player) {
    return charges.getOrDefault(player.getUniqueId(), 0);
  }

  boolean manages(Player player) {
    return !sealed.isSealed(player.getWorld())
        && context
            .services()
            .find(ArenaPresence.class)
            .map(arena -> arena.arenaOf(player.getUniqueId()).isEmpty())
            .orElse(true);
  }

  static boolean marked(@Nullable ItemStack item) {
    return item != null
        && item.hasItemMeta()
        && item.getItemMeta().getPersistentDataContainer().has(OWNER, PersistentDataType.STRING);
  }

  static ItemStack item(Player player, int remaining) {
    var item = new ItemStack(Material.COMPASS);
    item.editMeta(
        meta -> {
          meta.displayName(Component.text("Choose a Biome"));
          meta.lore(
              List.of(
                  Component.text(
                      "Left- or right-click to choose a biome. " + remaining + " trips left.")));
          meta.getPersistentDataContainer()
              .set(OWNER, PersistentDataType.STRING, player.getUniqueId().toString());
        });
    return item;
  }

  void reconcile(Player player) {
    if (!manages(player)) return;
    var inventory = player.getInventory();
    var at = inventory.getItem(SLOT);
    var left = charges.getOrDefault(player.getUniqueId(), 0);
    var inPlace =
        left > 0
            && at != null
            && marked(at)
            && player
                .getUniqueId()
                .toString()
                .equals(
                    at.getItemMeta()
                        .getPersistentDataContainer()
                        .get(OWNER, PersistentDataType.STRING));
    for (var slot = 0; slot < inventory.getSize(); slot++) {
      if (inPlace && slot == SLOT) continue;
      if (marked(inventory.getItem(slot))) inventory.setItem(slot, null);
    }
    if (inPlace || left == 0) return;
    at = inventory.getItem(SLOT);
    if (at != null && !at.isEmpty()) {
      var empty = emptyStorageSlot(inventory);
      if (empty == -1) {
        player.sendActionBar(Component.text("Free an inventory slot for your travel compass."));
        return;
      }
      inventory.setItem(empty, at);
    }
    inventory.setItem(SLOT, item(player, left));
  }

  private static int emptyStorageSlot(PlayerInventory inventory) {
    var storage = java.util.Objects.requireNonNull(inventory.getStorageContents());
    for (var slot = 0; slot < storage.length; slot++) {
      var existing = inventory.getItem(slot);
      if (existing == null || existing.isEmpty()) return slot;
    }
    return -1;
  }

  void arrived(Player player) {
    if (!pending(player)) return;
    var id = player.getUniqueId();
    var _ =
        store
            .spendStarterCharge(id)
            .whenCompleteAsync(
                (left, failure) -> {
                  if (failure != null) {
                    context.logger().error("Could not spend a compass trip for {}", id, failure);
                    return;
                  }
                  var remaining = left == null ? 0 : left;
                  if (remaining > 0) charges.put(id, remaining);
                  else charges.remove(id);
                  if (player.isOnline()) reconcile(player);
                },
                context.scheduler().mainThread());
  }

  void left(Player player) {
    charges.remove(player.getUniqueId());
  }

  void afterRespawn(Player player) {
    context
        .scheduler()
        .runOnMainThread(
            () -> {
              if (player.isOnline()) reconcile(player);
            });
  }
}
