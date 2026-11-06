package com.shepherdjerred.thestorm.shops.adapter.paper;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.bukkit.NamespacedKey;
import org.bukkit.block.Block;
import org.bukkit.block.Container;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;

/** Applies a one-time stock target to container snapshots on the server thread. */
final class HistoricalStock {
  private static final byte SINGLE = 1;
  private static final byte SPLIT = 2;
  private final Plugin plugin;

  HistoricalStock(Plugin plugin) {
    this.plugin = plugin;
  }

  enum Result {
    STOCKED,
    ALREADY_STOCKED,
    NO_CONTAINER,
    BUSY,
    NO_SPACE,
    CHANGED
  }

  /**
   * Existing goods count towards the target and insufficient capacity is never partly written.
   * Split writes mark both halves; the caller must keep an in-doubt receipt until all world writes
   * finish, so an interrupted split is never repeated automatically.
   */
  Result stock(Block block, String sourceId, ItemStack item, int target) {
    if (sourceId.isBlank() || item.getType().isAir() || target < 1) {
      throw new IllegalArgumentException("invalid historical stock request");
    }
    if (!(block.getState() instanceof Container container)) return Result.NO_CONTAINER;
    if (!container.getInventory().getViewers().isEmpty()) return Result.BUSY;
    var marker = marker(sourceId);
    var halves = halves(block, container);
    if (halves.stream()
        .anyMatch(half -> half.getPersistentDataContainer().has(marker, PersistentDataType.BYTE)))
      return Result.ALREADY_STOCKED;
    var needed = Math.max(0, target - matchingCount(container, item));
    for (var half : halves) {
      if (fill(half, marker, item, needed)) {
        return half.update(false, false) ? Result.STOCKED : Result.CHANGED;
      }
    }
    return split(block, marker, item, needed);
  }

  private static int matchingCount(Container container, ItemStack item) {
    var count = 0;
    // The live inventory spans both halves of a double chest; the snapshot is only this half.
    for (var stack :
        Objects.requireNonNull(container.getInventory().getContents(), "container contents")) {
      if (stack != null && stack.isSimilar(item)) count += stack.getAmount();
    }
    return count;
  }

  private boolean fill(Container container, NamespacedKey marker, ItemStack item, int needed) {
    var inventory = container.getSnapshotInventory();
    var remaining = needed;
    while (remaining > 0) {
      var amount = Math.min(remaining, item.getMaxStackSize());
      var addition = item.asQuantity(amount);
      if (!inventory.addItem(addition).isEmpty()) return false;
      remaining -= amount;
    }
    container.getPersistentDataContainer().set(marker, PersistentDataType.BYTE, SINGLE);
    return true;
  }

  private Result split(Block block, NamespacedKey marker, ItemStack item, int needed) {
    if (!(block.getState() instanceof Container container)) return Result.CHANGED;
    var halves = halves(block, container);
    if (halves.size() != 2) return Result.NO_SPACE;
    var remaining = needed;
    for (var half : halves) {
      var inventory = half.getSnapshotInventory();
      while (remaining > 0) {
        var amount = Math.min(remaining, item.getMaxStackSize());
        var leftovers = inventory.addItem(item.asQuantity(amount));
        var unplaced = leftovers.values().stream().mapToInt(ItemStack::getAmount).sum();
        remaining -= amount - unplaced;
        if (unplaced > 0) break;
      }
    }
    if (remaining > 0) return Result.NO_SPACE;
    for (var half : halves) {
      half.getPersistentDataContainer().set(marker, PersistentDataType.BYTE, SPLIT);
      if (!half.update(false, false)) return Result.CHANGED;
    }
    return Result.STOCKED;
  }

  boolean wasStocked(Block block, String sourceId) {
    if (!(block.getState(false) instanceof Container container)) return false;
    var values =
        halves(block, container).stream()
            .map(
                half ->
                    half.getPersistentDataContainer()
                        .get(marker(sourceId), PersistentDataType.BYTE))
            .filter(Objects::nonNull)
            .toList();
    return completeMarkers(values);
  }

  static boolean completeMarkers(List<Byte> values) {
    return (values.size() == 1 && values.getFirst() == SINGLE)
        || (values.size() == 2 && values.stream().allMatch(value -> value == SPLIT));
  }

  private static List<Container> halves(Block block, Container first) {
    var result = new ArrayList<Container>();
    result.add(first);
    if (first.getInventory().getHolder() instanceof org.bukkit.block.DoubleChest) {
      for (var pos : ShopBlocks.containerBlocks(block)) {
        if (pos.x() == block.getX() && pos.y() == block.getY() && pos.z() == block.getZ()) continue;
        var other = block.getWorld().getBlockAt(pos.x(), pos.y(), pos.z()).getState();
        if (other instanceof Container container) result.add(container);
      }
    }
    return result;
  }

  private NamespacedKey marker(String sourceId) {
    var hash = UUID.nameUUIDFromBytes(sourceId.getBytes(StandardCharsets.UTF_8));
    return new NamespacedKey(plugin, "heritage_stock_" + hash.toString().replace("-", ""));
  }
}
