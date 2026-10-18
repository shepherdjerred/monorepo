package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.qol.app.QolStore;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
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
  private final Set<UUID> pending = new HashSet<>();
  private final ModuleContext context;
  private final QolStore store;

  StarterCompass(ModuleContext context, QolStore store) {
    this.context = context;
    this.store = store;
  }

  void loaded(Player player, boolean needed) {
    if (needed) pending.add(player.getUniqueId());
    else pending.remove(player.getUniqueId());
    reconcile(player);
  }

  boolean pending(Player player) {
    return pending.contains(player.getUniqueId());
  }

  static boolean marked(@Nullable ItemStack item) {
    return item != null
        && item.hasItemMeta()
        && item.getItemMeta().getPersistentDataContainer().has(OWNER, PersistentDataType.STRING);
  }

  static ItemStack item(Player player) {
    var item = new ItemStack(Material.COMPASS);
    item.editMeta(
        meta -> {
          meta.displayName(Component.text("Choose a Biome"));
          meta.lore(List.of(Component.text("Left- or right-click to find your first home.")));
          meta.getPersistentDataContainer()
              .set(OWNER, PersistentDataType.STRING, player.getUniqueId().toString());
        });
    return item;
  }

  void reconcile(Player player) {
    var inventory = player.getInventory();
    var at = inventory.getItem(SLOT);
    var inPlace =
        pending(player)
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
    if (inPlace || !pending(player)) return;
    at = inventory.getItem(SLOT);
    if (at != null && !at.isEmpty()) {
      var empty = emptyStorageSlot(inventory);
      if (empty == -1) {
        player.sendActionBar(Component.text("Free an inventory slot for your travel compass."));
        return;
      }
      inventory.setItem(empty, at);
    }
    inventory.setItem(SLOT, item(player));
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
            .completeStarterRtp(id)
            .whenCompleteAsync(
                (done, failure) -> {
                  if (failure != null) {
                    context.logger().error("Could not finish starter RTP for {}", id, failure);
                    return;
                  }
                  pending.remove(id);
                  if (player.isOnline()) reconcile(player);
                },
                context.scheduler().mainThread());
  }

  void left(Player player) {
    pending.remove(player.getUniqueId());
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
