/* CraftBook crop IC ports. Authors: Drathus, Me4502 and the CraftBook contributors.
 * GNU GPL version 3 or later; upstream revision and copyright notice in NOTICE/IntegratedCircuits.
 */
package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.mechanics.domain.ic.CircuitArea;
import java.util.List;
import java.util.Optional;
import org.bukkit.Material;
import org.bukkit.Tag;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.Ageable;
import org.bukkit.block.data.Directional;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.Damageable;

/** MC1234, MC1235, MC1239 and MC1223 read their area, seeds and tools from the world. */
final class CropCircuits {
  private final CircuitAccess access;
  private final CircuitGrowth growth;

  CropCircuits(CircuitAccess access) {
    this.access = access;
    growth = new CircuitGrowth(access);
  }

  boolean plant(CircuitAccess.Visit visit, CircuitArea area) {
    var selected =
        visit.line(2).isBlank()
            ? Optional.<Material>empty()
            : Optional.of(CircuitAccess.material(visit.line(2)));
    var storage = access.inventory(visit, visit.storage());
    return storage.isPresent()
        ? fromInventory(visit, area, storage.orElseThrow(), selected)
        : fromGround(visit, area, selected);
  }

  private boolean fromInventory(
      CircuitAccess.Visit visit,
      CircuitArea area,
      Inventory inventory,
      Optional<Material> selected) {
    for (var item : java.util.Objects.requireNonNull(inventory.getStorageContents())) {
      if (item == null
          || (selected.isPresent() && item.getType() != selected.orElseThrow())
          || !inventory.containsAtLeast(ItemStack.of(item.getType()), 1)) continue;
      var target = access.sample(visit, area);
      if (target.isPresent()
          && place(
              visit,
              target.orElseThrow(),
              item.getType(),
              () -> {
                if (!CircuitAccess.take(inventory, item.getType(), 1))
                  throw new IllegalStateException("planting seed disappeared");
              })) return true;
    }
    return false;
  }

  private boolean fromGround(
      CircuitAccess.Visit visit, CircuitArea area, Optional<Material> selected) {
    for (var entity : access.entities(visit, area)) {
      if (!(entity instanceof org.bukkit.entity.Item item)
          || (selected.isPresent() && item.getItemStack().getType() != selected.orElseThrow())
          || !access.may(visit, item.getLocation().getBlock(), ProtectedAction.REMOVE_ITEM))
        continue;
      var target = access.sample(visit, area);
      if (target.isPresent()
          && place(visit, target.orElseThrow(), item.getItemStack().getType(), () -> take(item)))
        return true;
    }
    return false;
  }

  private static void take(org.bukkit.entity.Item item) {
    var stack = item.getItemStack();
    if (stack.getAmount() == 1) item.remove();
    else item.setItemStack(stack.asQuantity(stack.getAmount() - 1));
  }

  private boolean place(CircuitAccess.Visit visit, Block block, Material seed, Runnable consume) {
    if (!block.getType().isAir() || !access.may(visit, block, ProtectedAction.AUTOMATIC_BUILD))
      return false;
    var plant = plantType(seed);
    if (plant.isEmpty()) return false;
    var data = plant.orElseThrow().createBlockData();
    if (data instanceof Directional cocoa && plant.orElseThrow() == Material.COCOA) {
      var support =
          List.of(BlockFace.NORTH, BlockFace.EAST, BlockFace.SOUTH, BlockFace.WEST).stream()
              .filter(face ->
                  PaperGrid.loaded(block.getRelative(face))
                      && Tag.JUNGLE_LOGS.isTagged(block.getRelative(face).getType()))
              .findFirst();
      if (support.isEmpty()) return false;
      cocoa.setFacing(support.orElseThrow());
    }
    if (!block.canPlace(data)) return false;
    consume.run();
    access.set(visit, block, data);
    return true;
  }

  boolean cultivate(CircuitAccess.Visit visit, CircuitArea area) {
    var sampled = access.sample(visit, area);
    var inventory = access.inventory(visit, visit.storage());
    if (sampled.isEmpty() || inventory.isEmpty()) return false;
    var block = sampled.orElseThrow();
    if ((block.getType() != Material.DIRT && block.getType() != Material.GRASS_BLOCK)
        || !block.getRelative(BlockFace.UP).getType().isAir()
        || !access.may(
            visit, block, ProtectedAction.AUTOMATIC_BREAK, ProtectedAction.AUTOMATIC_BUILD))
      return false;
    var source = inventory.orElseThrow();
    for (var slot = 0; slot < source.getSize(); slot++) {
      var tool = source.getItem(slot);
      if (tool == null || !Tag.ITEMS_HOES.isTagged(tool.getType())) continue;
      var changed = tool.clone();
      if (!(changed.getItemMeta() instanceof Damageable damage))
        throw new IllegalStateException("hoe has no durability component");
      damage.setDamage(damage.getDamage() + 1);
      changed.setItemMeta(damage);
      source.setItem(
          slot, damage.getDamage() >= changed.getType().getMaxDurability() ? null : changed);
      access.set(visit, block, Material.FARMLAND.createBlockData());
      return true;
    }
    return false;
  }

  boolean harvest(CircuitAccess.Visit visit, CircuitArea area) {
    var sampled = access.sample(visit, area);
    if (sampled.isEmpty()) return false;
    var block = sampled.orElseThrow();
    if (!harvestable(block) || !access.may(visit, block, ProtectedAction.AUTOMATIC_BREAK))
      return false;
    var drops = block.getDrops();
    access.set(visit, block, Material.AIR.createBlockData());
    access.collect(visit, drops);
    return true;
  }

  boolean fertilize(CircuitAccess.Visit visit, CircuitArea area) {
    var sampled = access.sample(visit, area);
    var inventory = access.inventory(visit, visit.storage());
    if (sampled.isEmpty() || inventory.isEmpty()) return false;
    var source = inventory.orElseThrow();
    if (!source.containsAtLeast(ItemStack.of(Material.BONE_MEAL), 1)) return false;
    var block = sampled.orElseThrow();
    if (!access.may(visit, block, ProtectedAction.AUTOMATIC_BUILD)) return false;
    Runnable consume =
        () -> {
          if (!CircuitAccess.take(source, Material.BONE_MEAL, 1))
            throw new IllegalStateException("terraformer bonemeal disappeared");
        };
    return fertilizeCrop(visit, block, consume)
        || growth.grow(visit, block, consume)
        || terraform(visit, block, consume);
  }

  private boolean fertilizeCrop(CircuitAccess.Visit visit, Block block, Runnable consume) {
    if (!fertilizableCrop(block.getType())
        || !(block.getBlockData() instanceof Ageable age)
        || age.getAge() == age.getMaximumAge()) return false;
    var increment =
        block.getType() == Material.WHEAT || block.getType() == Material.NETHER_WART
            ? 1
            : access.context().random().nextInt(3);
    if (block.getType() == Material.COCOA)
      increment = access.context().random().nextInt(30) == 0 ? age.getMaximumAge() : 1;
    consume.run();
    age.setAge(Math.min(age.getMaximumAge(), age.getAge() + increment));
    access.set(visit, block, age);
    return true;
  }

  private boolean terraform(CircuitAccess.Visit visit, Block block, Runnable consume) {
    var type = block.getType();
    var target =
        type == Material.VINE ? block.getRelative(BlockFace.DOWN) : block.getRelative(BlockFace.UP);
    if (!PaperGrid.loaded(target)
        || !target.getType().isAir()
        || !access.may(visit, target, ProtectedAction.AUTOMATIC_BUILD)) return false;
    if (type == Material.DIRT) {
      consume.run();
      var replacement =
          block.getBiome().equals(org.bukkit.block.Biome.MUSHROOM_FIELDS)
              ? Material.MYCELIUM
              : Material.GRASS_BLOCK;
      access.set(visit, block, replacement.createBlockData());
      return true;
    }
    if (type == Material.SUGAR_CANE || type == Material.CACTUS) {
      consume.run();
      access.set(visit, target, type.createBlockData());
      return true;
    }
    var chance = type == Material.WATER ? 30 : 15;
    if (access.context().random().nextInt(chance) != 0) return false;
    var vegetation = vegetation(type);
    if (vegetation == null) return false;
    var data = type == Material.VINE ? block.getBlockData() : vegetation.createBlockData();
    if (!target.canPlace(data)) return false;
    consume.run();
    access.set(visit, target, data);
    return true;
  }

  private @org.jspecify.annotations.Nullable Material vegetation(Material type) {
    return switch (type) {
      case GRASS_BLOCK -> grassVegetation();
      case SAND -> Material.DEAD_BUSH;
      case MYCELIUM ->
          access.context().random().nextBoolean() ? Material.RED_MUSHROOM : Material.BROWN_MUSHROOM;
      case WATER -> Material.LILY_PAD;
      case VINE -> Material.VINE;
      default -> null;
    };
  }

  private Material grassVegetation() {
    return switch (access.context().random().nextInt(7)) {
      case 1 -> Material.DANDELION;
      case 2 -> Material.POPPY;
      case 3 -> Material.FERN;
      default -> Material.SHORT_GRASS;
    };
  }

  private static boolean fertilizableCrop(Material material) {
    return switch (material) {
      case WHEAT, CARROTS, POTATOES, MELON_STEM, PUMPKIN_STEM, COCOA, NETHER_WART -> true;
      default -> false;
    };
  }

  private static boolean harvestable(Block block) {
    var type = block.getType();
    if (Tag.LOGS.isTagged(type) || type == Material.MELON || type == Material.PUMPKIN) return true;
    if (block.getBlockData() instanceof Ageable age)
      return age.getAge() == age.getMaximumAge()
          && (type == Material.WHEAT
              || type == Material.CARROTS
              || type == Material.POTATOES
              || type == Material.COCOA
              || type == Material.NETHER_WART);
    if (type == Material.SUGAR_CANE || type == Material.CACTUS)
      return block.getRelative(BlockFace.DOWN).getType() == type
          && block.getRelative(BlockFace.UP).getType() != type;
    return type == Material.VINE
        && block.getRelative(BlockFace.UP).getType() == type
        && block.getRelative(BlockFace.DOWN).getType() != type;
  }

  private static Optional<Material> plantType(Material item) {
    return switch (item) {
      case WHEAT_SEEDS -> Optional.of(Material.WHEAT);
      case CARROT -> Optional.of(Material.CARROTS);
      case POTATO -> Optional.of(Material.POTATOES);
      case BEETROOT_SEEDS -> Optional.of(Material.BEETROOTS);
      case MELON_SEEDS -> Optional.of(Material.MELON_STEM);
      case PUMPKIN_SEEDS -> Optional.of(Material.PUMPKIN_STEM);
      case COCOA_BEANS -> Optional.of(Material.COCOA);
      case NETHER_WART, CACTUS, LILY_PAD, RED_MUSHROOM, BROWN_MUSHROOM -> Optional.of(item);
      default ->
          Tag.SAPLINGS.isTagged(item) || Tag.FLOWERS.isTagged(item)
              ? Optional.of(item)
              : Optional.empty();
    };
  }
}
