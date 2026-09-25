package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.mechanics.domain.structure.Stock;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Tag;
import org.bukkit.block.Sign;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.plugin.Plugin;

/**
 * What a mechanism sign remembers, in its persistent data: who created it (the player whose land
 * rights redstone and pistons act with), the blocks a bridge, door or gate holds while open, and a
 * cooking pot's fuel. The data travels with the sign block and is dropped with it.
 */
final class Signs {

  private final NamespacedKey owner;
  private final NamespacedKey stockMaterial;
  private final NamespacedKey stockCount;
  private final NamespacedKey fuel;

  Signs(Plugin plugin) {
    owner = new NamespacedKey(plugin, "mechanic_owner");
    stockMaterial = new NamespacedKey(plugin, "mechanic_stock_material");
    stockCount = new NamespacedKey(plugin, "mechanic_stock_count");
    fuel = new NamespacedKey(plugin, "mechanic_fuel");
  }

  static boolean isSign(Material material) {
    return Tag.ALL_SIGNS.isTagged(material);
  }

  static boolean isHanging(Material material) {
    return Tag.ALL_HANGING_SIGNS.isTagged(material);
  }

  Optional<UUID> owner(Sign sign) {
    return Optional.ofNullable(
            sign.getPersistentDataContainer().get(owner, PersistentDataType.STRING))
        .map(UUID::fromString);
  }

  /** Records {@code player} as the creator. Call {@link Sign#update()} afterwards. */
  void setOwner(Sign sign, UUID player) {
    sign.getPersistentDataContainer().set(owner, PersistentDataType.STRING, player.toString());
  }

  Stock stock(Sign sign) {
    var data = sign.getPersistentDataContainer();
    var count = data.getOrDefault(stockCount, PersistentDataType.INTEGER, 0);
    var material = data.get(stockMaterial, PersistentDataType.STRING);
    if (count == 0 || material == null) {
      return Stock.empty();
    }
    return Stock.of(material, count);
  }

  /** Stores {@code stock}. Call {@link Sign#update()} afterwards. */
  void setStock(Sign sign, Stock stock) {
    var data = sign.getPersistentDataContainer();
    if (stock.isEmpty()) {
      data.remove(stockMaterial);
      data.remove(stockCount);
      return;
    }
    data.set(stockMaterial, PersistentDataType.STRING, stock.material().orElseThrow());
    data.set(stockCount, PersistentDataType.INTEGER, stock.count());
  }

  int fuel(Sign sign) {
    return sign.getPersistentDataContainer().getOrDefault(fuel, PersistentDataType.INTEGER, 0);
  }

  /** Stores a cooking pot's fuel. Call {@link Sign#update()} afterwards. */
  void setFuel(Sign sign, int units) {
    sign.getPersistentDataContainer().set(fuel, PersistentDataType.INTEGER, units);
  }
}
