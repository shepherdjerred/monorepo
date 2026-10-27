package com.shepherdjerred.thestorm.qol.adapter.paper;

import com.shepherdjerred.thestorm.arena.app.ArenaPresence;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.world.SealedWorlds;
import com.shepherdjerred.thestorm.qol.app.QolStore;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
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
  private final Map<UUID, Integer> charges = new HashMap<>();
  private final Map<UUID, Integer> holds = new HashMap<>();
  private final Set<UUID> discarding = new HashSet<>();
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

  /**
   * Reserves one trip before travel starts. A replayed dialog callback cannot pass this once the
   * balance is exhausted, including while an earlier trip is still in flight.
   */
  boolean hold(Player player) {
    var id = player.getUniqueId();
    var left = charges.getOrDefault(id, 0);
    if (left <= 0) return false;
    var remaining = left - 1;
    if (remaining > 0) charges.put(id, remaining);
    else charges.remove(id);
    holds.merge(id, 1, Integer::sum);
    reconcile(player);
    return true;
  }

  /** Gives back a reservation when the trip does not arrive. */
  void refund(Player player) {
    var id = player.getUniqueId();
    var held = holds.getOrDefault(id, 0);
    if (held <= 0) return;
    if (held == 1) holds.remove(id);
    else holds.put(id, held - 1);
    if (!player.isOnline()) return;
    charges.merge(id, 1, Integer::sum);
    reconcile(player);
  }

  void arrived(Player player) {
    var id = player.getUniqueId();
    var held = holds.getOrDefault(id, 0);
    var consumed = held > 0;
    if (consumed) {
      if (held == 1) holds.remove(id);
      else holds.put(id, held - 1);
    } else if (!pending(player)) return;
    var arrival = new Arrival(player, id, consumed);
    var _ =
        store
            .spendStarterCharge(id)
            .whenCompleteAsync(
                (left, failure) -> finishArrival(arrival, left, failure),
                context.scheduler().mainThread());
  }

  private record Arrival(Player player, UUID id, boolean consumed) {}

  private void finishArrival(Arrival arrival, @Nullable Integer left, @Nullable Throwable failure) {
    var player = arrival.player();
    if (failure != null) {
      context.logger().error("Could not spend a compass trip for {}", arrival.id(), failure);
      if (arrival.consumed() && player.isOnline()) {
        charges.merge(arrival.id(), 1, Integer::sum);
        reconcile(player);
      }
      return;
    }
    if (!arrival.consumed()) {
      var remaining = left == null ? 0 : left;
      if (remaining > 0) charges.put(arrival.id(), remaining);
      else charges.remove(arrival.id());
    }
    if (player.isOnline()) reconcile(player);
  }

  void discard(Player player, ItemStack item) {
    var id = player.getUniqueId();
    if (!discarding.add(id)) return;
    var discarded = item.clone();
    var _ =
        store
            .discardStarterCompass(id)
            .whenCompleteAsync(
                (ignored, failure) -> {
                  discarding.remove(id);
                  if (failure != null) {
                    context
                        .logger()
                        .error("Could not discard the travel compass for {}", id, failure);
                    if (player.isOnline()) {
                      player.sendActionBar(
                          Component.text("Could not discard your compass. Try again."));
                    }
                    return;
                  }
                  charges.remove(id);
                  if (!player.isOnline()) return;
                  reconcile(player);
                  var at = Blocks.at(player);
                  var drop = player.getWorld().dropItem(at, discarded);
                  drop.setVelocity(at.getDirection().multiply(0.3));
                },
                context.scheduler().mainThread());
  }

  void left(Player player) {
    var id = player.getUniqueId();
    charges.remove(id);
    holds.remove(id);
    discarding.remove(id);
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
