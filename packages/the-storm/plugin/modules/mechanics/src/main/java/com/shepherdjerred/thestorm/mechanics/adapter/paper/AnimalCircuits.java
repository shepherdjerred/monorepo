/* CraftBook animal IC ports, GNU GPL version 3 or later.
 * Upstream revision and original copyright notice: NOTICE and IntegratedCircuits.
 */
package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import static java.util.Objects.requireNonNull;

import com.shepherdjerred.thestorm.core.protection.HarmTarget;
import com.shepherdjerred.thestorm.mechanics.domain.ic.CircuitArea;
import java.util.HashMap;
import org.bukkit.Material;
import org.bukkit.entity.Animals;
import org.bukkit.entity.Cow;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Sheep;
import org.bukkit.entity.Tameable;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.jspecify.annotations.Nullable;

/** MC1244 milks and shears; MC1280 consumes real food and breeds eligible animal pairs. */
final class AnimalCircuits {
  private final CircuitAccess access;

  AnimalCircuits(CircuitAccess access) {
    this.access = access;
  }

  boolean harvest(CircuitAccess.Visit visit, CircuitArea area) {
    var source = access.inventory(visit, visit.storage());
    if (source.isEmpty()) return false;
    var inventory = source.orElseThrow();
    for (var entity : access.entities(visit, area)) {
      if (!(entity instanceof Animals animal) || !animal.isAdult() || !allowed(visit, animal))
        continue;
      if (harvest(animal, inventory)) return true;
    }
    return false;
  }

  private boolean harvest(Animals animal, Inventory inventory) {
    var server = access.context().plugin().getServer();
    var planned =
        inventory.getSize() % 9 == 0
            ? server.createInventory(null, inventory.getSize())
            : server.createInventory(null, inventory.getType());
    planned.setStorageContents(requireNonNull(inventory.getStorageContents()));
    if (animal instanceof Cow && CircuitAccess.take(planned, Material.BUCKET, 1)) {
      if (!planned.addItem(ItemStack.of(Material.MILK_BUCKET)).isEmpty()) return false;
      inventory.setStorageContents(requireNonNull(planned.getStorageContents()));
      return true;
    }
    if (animal instanceof Sheep sheep
        && !sheep.isSheared()
        && inventory.contains(Material.SHEARS)) {
      var wool = Material.valueOf(requireNonNull(sheep.getColor()).name() + "_WOOL");
      if (!planned.addItem(ItemStack.of(wool, 3)).isEmpty()) return false;
      inventory.setStorageContents(requireNonNull(planned.getStorageContents()));
      sheep.setSheared(true);
      return true;
    }
    return false;
  }

  boolean breed(CircuitAccess.Visit visit, CircuitArea area) {
    var source = access.inventory(visit, visit.storage());
    if (source.isEmpty()) return false;
    var inventory = source.orElseThrow();
    var partners = new HashMap<EntityType, Animals>();
    for (var entity : access.entities(visit, area)) {
      if (!(entity instanceof Animals animal)
          || !animal.isAdult()
          || !animal.canBreed()
          || !allowed(visit, animal)) continue;
      var food = food(animal.getType());
      if (food == null || !inventory.containsAtLeast(ItemStack.of(food), 2)) continue;
      var partner = partners.putIfAbsent(animal.getType(), animal);
      if (partner == null) continue;
      return breedPair(visit, inventory, new Pair(animal, partner, food));
    }
    return false;
  }

  private record Pair(Animals first, Animals second, Material food) {}

  private boolean breedPair(CircuitAccess.Visit visit, Inventory inventory, Pair pair) {
    var animal = pair.first();
    var partner = pair.second();
    var food = pair.food();
    if (!CircuitAccess.take(inventory, food, 2))
      throw new IllegalStateException("breeding food disappeared");
    var spawned = animal.getWorld().spawnEntity(animal.getLocation(), animal.getType());
    if (!(spawned instanceof Animals baby) || !spawned.isValid()) {
      spawned.remove();
      access.collect(visit, java.util.List.of(ItemStack.of(food, 2)));
      return false;
    }
    baby.setBaby();
    animal.setBreed(false);
    partner.setBreed(false);
    if (animal instanceof Sheep sheep && baby instanceof Sheep lamb)
      lamb.setColor(sheep.getColor());
    return true;
  }

  private static @Nullable Material food(EntityType type) {
    return switch (type) {
      case COW, SHEEP -> Material.WHEAT;
      case PIG -> Material.CARROT;
      case CHICKEN -> Material.WHEAT_SEEDS;
      case WOLF -> Material.BEEF;
      default -> null;
    };
  }

  private boolean allowed(CircuitAccess.Visit visit, Animals animal) {
    if (animal instanceof Tameable tame
        && tame.isTamed()
        && (tame.getOwner() == null || !tame.getOwner().getUniqueId().equals(visit.actor())))
      return false;
    return access.protection().sameLand(visit.block().getLocation(), animal.getLocation())
        && access
            .protection()
            .checkHarm(
                visit.actor(),
                visit.block().getLocation(),
                HarmTarget.PASSIVE,
                animal.getLocation())
            .isAllowed();
  }
}
