package com.shepherdjerred.thestorm.essentials.adapter.paper;

import java.util.List;
import java.util.Optional;
import net.kyori.adventure.text.Component;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;
import org.bukkit.persistence.PersistentDataType;
import org.jspecify.annotations.Nullable;

/** The recovery compass that returns a player to a recent death. */
final class ReturnToken {
  static final int SLOT = 7;
  static final int FIRST_DEATHS = 5;
  private static final NamespacedKey OWNER = new NamespacedKey("thestorm", "return_owner");
  private static final NamespacedKey WORLD = new NamespacedKey("thestorm", "return_world");
  private static final NamespacedKey X = new NamespacedKey("thestorm", "return_x");
  private static final NamespacedKey Y = new NamespacedKey("thestorm", "return_y");
  private static final NamespacedKey Z = new NamespacedKey("thestorm", "return_z");
  private static final NamespacedKey YAW = new NamespacedKey("thestorm", "return_yaw");
  private static final NamespacedKey PITCH = new NamespacedKey("thestorm", "return_pitch");

  private ReturnToken() {}

  static boolean marked(@Nullable ItemStack item) {
    return item != null
        && item.hasItemMeta()
        && item.getItemMeta().getPersistentDataContainer().has(OWNER, PersistentDataType.STRING);
  }

  static ItemStack item(Player player, Location death, int shown) {
    var stack = new ItemStack(Material.RECOVERY_COMPASS);
    stack.editMeta(
        meta -> {
          meta.displayName(Component.text("Return"));
          meta.lore(List.of(Component.text(shown + " left.")));
          var data = meta.getPersistentDataContainer();
          data.set(OWNER, PersistentDataType.STRING, player.getUniqueId().toString());
          data.set(WORLD, PersistentDataType.STRING, death.getWorld().getName());
          data.set(X, PersistentDataType.DOUBLE, death.getX());
          data.set(Y, PersistentDataType.DOUBLE, death.getY());
          data.set(Z, PersistentDataType.DOUBLE, death.getZ());
          data.set(YAW, PersistentDataType.FLOAT, death.getYaw());
          data.set(PITCH, PersistentDataType.FLOAT, death.getPitch());
        });
    return stack;
  }

  static Optional<Location> destination(org.bukkit.Server server, ItemStack item) {
    if (!marked(item)) return Optional.empty();
    var data = item.getItemMeta().getPersistentDataContainer();
    var worldName = data.get(WORLD, PersistentDataType.STRING);
    var x = data.get(X, PersistentDataType.DOUBLE);
    var y = data.get(Y, PersistentDataType.DOUBLE);
    var z = data.get(Z, PersistentDataType.DOUBLE);
    var yaw = data.get(YAW, PersistentDataType.FLOAT);
    var pitch = data.get(PITCH, PersistentDataType.FLOAT);
    if (worldName == null || x == null || y == null || z == null || yaw == null || pitch == null) {
      return Optional.empty();
    }
    World world = server.getWorld(worldName);
    if (world == null) return Optional.empty();
    return Optional.of(new Location(world, x, y, z, yaw, pitch));
  }

  static void place(Player player, ItemStack item) {
    var inventory = player.getInventory();
    for (var slot = 0; slot < inventory.getSize(); slot++) {
      if (marked(inventory.getItem(slot))) inventory.setItem(slot, null);
    }
    var at = inventory.getItem(SLOT);
    if (at != null && !at.isEmpty()) {
      var empty = emptyStorageSlot(inventory);
      if (empty != -1) inventory.setItem(empty, at);
    }
    inventory.setItem(SLOT, item);
  }

  static void remove(Player player) {
    var inventory = player.getInventory();
    for (var slot = 0; slot < inventory.getSize(); slot++) {
      if (marked(inventory.getItem(slot))) inventory.setItem(slot, null);
    }
  }

  private static int emptyStorageSlot(PlayerInventory inventory) {
    var storage = java.util.Objects.requireNonNull(inventory.getStorageContents());
    for (var slot = 0; slot < storage.length; slot++) {
      var existing = inventory.getItem(slot);
      if (existing == null || existing.isEmpty()) return slot;
    }
    return -1;
  }
}
