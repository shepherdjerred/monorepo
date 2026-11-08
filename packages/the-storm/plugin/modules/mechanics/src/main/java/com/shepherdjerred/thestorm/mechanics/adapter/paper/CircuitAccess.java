package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import com.shepherdjerred.thestorm.core.material.LegacyItemKeys;
import com.shepherdjerred.thestorm.core.module.ModuleContext;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import com.shepherdjerred.thestorm.core.protection.ReservedContainers;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.ic.CircuitArea;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.block.BlockFace;
import org.bukkit.block.Container;
import org.bukkit.block.Sign;
import org.bukkit.entity.Entity;
import org.bukkit.inventory.DoubleChestInventory;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

/** Permission-checked access to the physical inputs of an IC. No file or database definitions. */
record CircuitAccess(ModuleContext context, Kit kit, Protection protection) {
  record Visit(
      Block block, Sign sign, BlockFace front, UUID actor, boolean polling, boolean input) {
    Block support() {
      return block.getRelative(front.getOppositeFace());
    }

    Block storage() {
      return support().getRelative(BlockFace.UP);
    }

    String line(int index) {
      return PaperGrid.frontLines(sign).get(index).strip();
    }

    BlockFace left() {
      return switch (front) {
        case NORTH -> BlockFace.EAST;
        case EAST -> BlockFace.SOUTH;
        case SOUTH -> BlockFace.WEST;
        case WEST -> BlockFace.NORTH;
        default -> throw new IllegalStateException("a circuit must face horizontally");
      };
    }
  }

  boolean may(Visit visit, Block block, ProtectedAction... actions) {
    if (!PaperGrid.loaded(block)
        || !protection.sameLand(visit.block().getLocation(), block.getLocation())) return false;
    return Arrays.stream(actions)
        .allMatch(
            action -> protection.check(visit.actor(), action, block.getLocation()).isAllowed());
  }

  Optional<Inventory> inventory(Visit visit, Block block) {
    if (!may(
            visit,
            block,
            ProtectedAction.OPEN_CONTAINER,
            ProtectedAction.INSERT_ITEM,
            ProtectedAction.REMOVE_ITEM)
        || context
            .services()
            .find(ReservedContainers.class)
            .filter(reserved -> reserved.contains(block.getLocation()))
            .isPresent()) return Optional.empty();
    if (!(block.getState(false) instanceof Container container)) return Optional.empty();
    var inventory = container.getInventory();
    if (inventory instanceof DoubleChestInventory chest) {
      for (var half : List.of(chest.getLeftSide(), chest.getRightSide())) {
        var at = half.getLocation();
        if (at == null
            || !may(
                visit,
                at.getBlock(),
                ProtectedAction.OPEN_CONTAINER,
                ProtectedAction.INSERT_ITEM,
                ProtectedAction.REMOVE_ITEM)
            || context
                .services()
                .find(ReservedContainers.class)
                .filter(reserved -> reserved.contains(at))
                .isPresent()) return Optional.empty();
      }
    }
    return Optional.of(inventory);
  }

  CircuitArea area(Visit visit, int line) {
    return CircuitArea.parse(
        visit.line(line), PaperGrid.pos(visit.support()), Direction.valueOf(visit.front().name()));
  }

  Optional<Block> sample(Visit visit, CircuitArea area) {
    var pos = area.sample(context.random());
    var world = visit.block().getWorld();
    if (pos.y() < world.getMinHeight()
        || pos.y() >= world.getMaxHeight()
        || !world.isChunkLoaded(pos.x() >> 4, pos.z() >> 4)) return Optional.empty();
    return Optional.of(world.getBlockAt(pos.x(), pos.y(), pos.z()));
  }

  Collection<Entity> entities(Visit visit, CircuitArea area) {
    var center = area.center();
    var at = new org.bukkit.Location(visit.block().getWorld(), center.x(), center.y(), center.z());
    return at.getWorld()
        .getNearbyEntities(at, area.radius().x(), area.radius().y(), area.radius().z());
  }

  static Material material(String text) {
    var key = LegacyItemKeys.resolve(text).orElse(text);
    var material = Material.matchMaterial(key);
    if (material == null || material.isAir())
      throw new IllegalArgumentException("unknown circuit item " + text);
    return material;
  }

  static boolean take(Inventory inventory, Material material, int amount) {
    var item = ItemStack.of(material, amount);
    return inventory.containsAtLeast(item, amount) && inventory.removeItem(item).isEmpty();
  }

  void collect(Visit visit, Collection<ItemStack> items) {
    emit(visit, visit.storage(), items);
  }

  void emit(Visit visit, Block destination, Collection<ItemStack> items) {
    var inventory = inventory(visit, destination);
    Collection<ItemStack> left =
        inventory.isPresent()
            ? inventory
                .orElseThrow()
                .addItem(items.stream().map(ItemStack::clone).toArray(ItemStack[]::new))
                .values()
            : items;
    for (var item : left)
      visit
          .block()
          .getWorld()
          .dropItemNaturally(visit.block().getLocation().toCenterLocation(), item.clone());
  }

  void set(Visit visit, Block block, org.bukkit.block.data.BlockData data) {
    kit.changes().set(visit.actor().toString(), block, data, true);
  }
}
