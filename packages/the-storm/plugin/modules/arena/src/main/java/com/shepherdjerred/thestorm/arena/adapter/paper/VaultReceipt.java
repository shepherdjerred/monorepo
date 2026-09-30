package com.shepherdjerred.thestorm.arena.adapter.paper;

import java.util.Arrays;
import java.util.List;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;

/** Reward IDs saved with the inventory they were delivered into. */
final class VaultReceipt {

  private final NamespacedKey key;

  VaultReceipt(Plugin plugin) {
    key = new NamespacedKey(plugin, "arena_vault_receipts");
  }

  List<Long> ids(Player player) {
    var stored = player.getPersistentDataContainer().get(key, PersistentDataType.LONG_ARRAY);
    if (stored == null) {
      return List.of();
    }
    var ids = Arrays.stream(stored).boxed().toList();
    if (ids.stream().anyMatch(id -> id <= 0) || ids.stream().distinct().count() != ids.size()) {
      throw new IllegalStateException("Invalid vault receipts for " + player.getUniqueId());
    }
    return ids;
  }

  void record(Player player, long id) {
    if (id <= 0) {
      throw new IllegalArgumentException("Vault reward ID must be positive");
    }
    var ids = ids(player);
    if (ids.contains(id)) {
      return;
    }
    var recorded = new long[ids.size() + 1];
    for (var index = 0; index < ids.size(); index++) {
      recorded[index] = ids.get(index);
    }
    recorded[ids.size()] = id;
    player.getPersistentDataContainer().set(key, PersistentDataType.LONG_ARRAY, recorded);
  }

  void clear(Player player, List<Long> ids) {
    var remaining =
        ids(player).stream().filter(id -> !ids.contains(id)).mapToLong(Long::longValue).toArray();
    if (remaining.length == 0) {
      player.getPersistentDataContainer().remove(key);
    } else {
      player.getPersistentDataContainer().set(key, PersistentDataType.LONG_ARRAY, remaining);
    }
  }
}
