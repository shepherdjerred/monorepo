package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.survival.SupplyBank;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.bukkit.inventory.ItemStack;
import org.jspecify.annotations.Nullable;

/** Private metadata-preserving lockers beside the run's shared fungible supplies. */
final class SurvivalBank {
  private final SupplyBank supplies = new SupplyBank();
  private final Map<UUID, @Nullable ItemStack[]> lockers = new HashMap<>();

  SupplyBank supplies() {
    return supplies;
  }

  @Nullable ItemStack[] contents(UUID player) {
    return copy(locker(player));
  }

  private @Nullable ItemStack[] locker(UUID player) {
    return lockers.computeIfAbsent(player, _ -> new ItemStack[54]);
  }

  boolean fits(UUID player, java.util.List<ItemStack> bundle) {
    return insert(copy(locker(player)), bundle);
  }

  boolean store(UUID player, java.util.List<ItemStack> bundle) {
    var next = copy(locker(player));
    if (!insert(next, bundle)) return false;
    lockers.put(player, next);
    return true;
  }

  @Nullable ItemStack take(UUID player, int slot) {
    if (slot < 0 || slot >= 54) return null;
    var locker = locker(player);
    var item = locker[slot];
    locker[slot] = null;
    return item == null ? null : item.clone();
  }

  boolean exchange(UUID player, int slot, ItemStack expected, ItemStack replacement) {
    var next = copy(locker(player));
    if (slot < 0 || slot >= next.length || !expected.equals(next[slot])) return false;
    next[slot] = null;
    if (!insert(next, java.util.List.of(replacement))) return false;
    lockers.put(player, next);
    return true;
  }

  void leave(UUID player) {
    lockers.remove(player);
  }

  static @Nullable ItemStack[] copy(@Nullable ItemStack[] original) {
    var result = original.clone();
    for (var i = 0; i < result.length; i++) {
      if (result[i] != null) result[i] = result[i].clone();
    }
    return result;
  }

  static boolean insert(@Nullable ItemStack[] storage, java.util.List<ItemStack> bundle) {
    return insert(storage, bundle, _ -> true);
  }

  static boolean insert(
      @Nullable ItemStack[] storage,
      java.util.List<ItemStack> bundle,
      java.util.function.IntPredicate allowed) {
    for (var item : bundle) {
      if (!insert(storage, item, allowed)) return false;
    }
    return true;
  }

  private static boolean insert(
      @Nullable ItemStack[] storage, ItemStack item, java.util.function.IntPredicate allowed) {
    var left = item.getAmount();
    for (var slot = 0; slot < storage.length && left > 0; slot++) {
      if (!allowed.test(slot)) continue;
      var existing = storage[slot];
      if (existing != null && !existing.isEmpty() && !existing.isSimilar(item)) continue;
      var count = existing == null || existing.isEmpty() ? 0 : existing.getAmount();
      var added = Math.min(left, item.getMaxStackSize() - count);
      if (added <= 0) continue;
      var merged = item.clone();
      merged.setAmount(count + added);
      storage[slot] = merged;
      left -= added;
    }
    return left == 0;
  }
}
