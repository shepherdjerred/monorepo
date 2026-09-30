package com.shepherdjerred.thestorm.shards.adapter.paper;

import com.shepherdjerred.thestorm.shards.app.StormShards;
import com.shepherdjerred.thestorm.shards.domain.ShardItemConfig;
import io.papermc.paper.datacomponent.DataComponentTypes;
import io.papermc.paper.datacomponent.item.ItemLore;
import java.util.OptionalInt;
import net.kyori.adventure.key.Key;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;

/**
 * Creates and recognises Storm Shards. A shard is any item carrying the {@code thestorm:shard}
 * persistent data key; its name, lore and model are presentation only.
 */
final class ShardItems implements StormShards {

  private final NamespacedKey shardKey;
  private final StormGear gear;
  private final ItemStack template;

  ShardItems(NamespacedKey shardKey, StormGear gear, ShardItemConfig config) {
    this.shardKey = shardKey;
    this.gear = gear;
    this.template = buildTemplate(shardKey, config);
  }

  private static ItemStack buildTemplate(NamespacedKey shardKey, ShardItemConfig config) {
    var material = PaperNames.item("item.material", config.material());
    var item = ItemStack.of(material);
    item.setData(DataComponentTypes.ITEM_NAME, ShardText.itemText(config.name()));
    item.setData(
        DataComponentTypes.LORE,
        ItemLore.lore(config.lore().stream().map(line -> ShardText.itemText(line)).toList()));
    item.setData(DataComponentTypes.ITEM_MODEL, Key.key(config.itemModel()));
    if (config.glint()) {
      item.setData(DataComponentTypes.ENCHANTMENT_GLINT_OVERRIDE, true);
    }
    item.editPersistentDataContainer(pdc -> pdc.set(shardKey, PersistentDataType.BOOLEAN, true));
    return item;
  }

  @Override
  public ItemStack create(int amount) {
    if (amount < 1 || amount > template.getMaxStackSize()) {
      throw new IllegalArgumentException(
          "a shard stack holds 1.." + template.getMaxStackSize() + " but was " + amount);
    }
    return template.asQuantity(amount);
  }

  @Override
  public boolean isShard(ItemStack item) {
    return !item.isEmpty()
        && item.getPersistentDataContainer().has(shardKey, PersistentDataType.BOOLEAN);
  }

  @Override
  public OptionalInt stormTier(ItemStack item) {
    return gear.tierOf(item)
        .map(tier -> OptionalInt.of(tier.level()))
        .orElseGet(OptionalInt::empty);
  }

  /** How many shards {@code inventory} holds. */
  int count(Inventory inventory) {
    var total = 0;
    for (var slot = 0; slot < inventory.getSize(); slot++) {
      var item = inventory.getItem(slot);
      if (item != null && isShard(item)) {
        total += item.getAmount();
      }
    }
    return total;
  }

  /** Removes exactly {@code amount} shards; the caller has checked {@link #count}. */
  void take(Inventory inventory, int amount) {
    var remaining = amount;
    for (var slot = 0; slot < inventory.getSize() && remaining > 0; slot++) {
      var item = inventory.getItem(slot);
      if (item == null || !isShard(item)) {
        continue;
      }
      var taken = Math.min(remaining, item.getAmount());
      remaining -= taken;
      inventory.setItem(
          slot, item.getAmount() == taken ? null : item.asQuantity(item.getAmount() - taken));
    }
    if (remaining > 0) {
      throw new IllegalStateException("inventory held " + remaining + " fewer shards than counted");
    }
  }

  /** Gives {@code amount} shards, dropping what does not fit at the player's feet. */
  void give(Player player, int amount) {
    // Entity's location, not OfflinePlayer's nullable one: an online player is always somewhere.
    Entity entity = player;
    var feet = entity.getLocation();
    var remaining = amount;
    while (remaining > 0) {
      var stack = create(Math.min(remaining, template.getMaxStackSize()));
      remaining -= stack.getAmount();
      for (var left : player.getInventory().addItem(stack).values()) {
        player.getWorld().dropItemNaturally(feet, left);
      }
    }
  }

  Material material() {
    return template.getType();
  }
}
