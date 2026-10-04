package com.shepherdjerred.thestorm.companions.adapter.paper;

import static java.util.Objects.requireNonNull;

import com.shepherdjerred.thestorm.companions.adapter.coreprotect.NaturalBlockAudit;
import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.protection.Protection;
import java.util.Optional;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.entity.Item;
import org.bukkit.entity.Player;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityPickupItemEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;

/** Main-thread transactions use ordinary protection, reach, inventory and Bukkit events. */
public final class SurvivalActions {
  private final Protection protection;
  private final NaturalBlockAudit audit;

  public SurvivalActions(Protection protection, NaturalBlockAudit audit) {
    this.protection = protection;
    this.audit = audit;
  }

  boolean allowed(Player player, ProtectedAction action, Block block) {
    return block.getWorld().isChunkLoaded(block.getX() >> 4, block.getZ() >> 4)
        && protection.check(player.getUniqueId(), action, block.getLocation()).isAllowed();
  }

  static boolean reach(Player player, Block block) {
    var center = block.getLocation().add(0.5, 0.5, 0.5);
    var distance = player.getEyeLocation().distance(center);
    if (!player.getWorld().equals(block.getWorld())
        || player.getEyeLocation().distanceSquared(center) > 20.25) return false;
    var direction = center.subtract(player.getEyeLocation()).toVector().normalize();
    var ray = player.getWorld().rayTraceBlocks(player.getEyeLocation(), direction, distance);
    return ray == null || block.equals(ray.getHitBlock());
  }

  public boolean mine(Player player, Block block, Material expected, String owner) {
    if (block.getType() != expected
        || !allowed(player, ProtectedAction.BREAK, block)
        || !reach(player, block)
        || !audit.unqueued(block, owner, player.getName())) return false;
    var data = block.getBlockData();
    var at = block.getLocation();
    player.swingMainHand();
    if (!player.breakBlock(block)) return false;
    audit.removed(owner, at, expected, data);
    return true;
  }

  public boolean place(Player player, Block block, Material material, String owner) {
    if (!allowed(player, ProtectedAction.BUILD, block)
        || !block.isEmpty()
        || !reach(player, block)
        || !audit.unqueued(block, owner, player.getName())
        || org.bukkit.util.BoundingBox.of(block).overlaps(player.getBoundingBox())) return false;
    equip(player, material);
    var slot = slot(player, material);
    if (slot.isEmpty()) return false;
    var support =
        java.util.Arrays.stream(org.bukkit.block.BlockFace.values())
            .filter(
                face ->
                    face.getModX() * face.getModX()
                            + face.getModY() * face.getModY()
                            + face.getModZ() * face.getModZ()
                        == 1)
            .map(block::getRelative)
            .filter(relative -> relative.getType().isSolid())
            .findFirst();
    if (support.isEmpty()) return false;
    var item = requireNonNull(player.getInventory().getItem(slot.get()));
    var previous = block.getState();
    var data = material.createBlockData();
    block.setBlockData(data, false);
    var event =
        new BlockPlaceEvent(
            block, previous, support.get(), item.clone(), player, true, EquipmentSlot.HAND);
    Bukkit.getPluginManager().callEvent(event);
    if (event.isCancelled() || !event.canBuild()) {
      previous.update(true, false);
      return false;
    }
    if (!item.equals(player.getInventory().getItem(slot.get())) || block.getType() != material) {
      previous.update(true, false);
      throw new IllegalStateException("placement changed during event delivery");
    }
    item.subtract();
    player.getInventory().setItem(slot.get(), item);
    block.setBlockData(data, true);
    player.swingMainHand();
    audit.placed(owner, block.getLocation(), material, data);
    return true;
  }

  boolean pickup(Player player, Item item) {
    if (!item.isValid()
        || item.getPickupDelay() > 0
        || item.getLocation().distanceSquared(requireNonNull(player.getLocation())) > 4
        || (item.getOwner() != null && !player.getUniqueId().equals(item.getOwner()))
        || !protection
            .check(player.getUniqueId(), ProtectedAction.OPEN_CONTAINER, item.getLocation())
            .isAllowed()) return false;
    var stack = item.getItemStack();
    var simulated = Bukkit.createInventory(null, 36);
    simulated.setContents(
        java.util.Arrays.stream(requireNonNull(player.getInventory().getStorageContents()))
            .map(value -> value == null ? new ItemStack(Material.AIR) : value.clone())
            .toArray(ItemStack[]::new));
    if (!simulated.addItem(stack.clone()).isEmpty()) return false;
    var event = new EntityPickupItemEvent(player, item, 0);
    Bukkit.getPluginManager().callEvent(event);
    if (event.isCancelled() || !item.isValid()) return false;
    if (!stack.equals(item.getItemStack()))
      throw new IllegalStateException("pickup stack changed during event delivery");
    if (!player.getInventory().addItem(stack.clone()).isEmpty())
      throw new IllegalStateException("pickup capacity changed during event delivery");
    item.remove();
    return true;
  }

  boolean plant(Player player, Block block, String owner) {
    if (!allowed(player, ProtectedAction.BUILD, block)
        || !block.isEmpty()
        || block.getRelative(0, -1, 0).getType() != Material.FARMLAND
        || !reach(player, block)
        || !audit.unqueued(block, owner, player.getName())) return false;
    equip(player, Material.WHEAT_SEEDS);
    var seed = slot(player, Material.WHEAT_SEEDS);
    if (seed.isEmpty()) return false;
    var item = requireNonNull(player.getInventory().getItem(seed.get()));
    var previous = block.getState();
    var crop = Material.WHEAT.createBlockData();
    block.setBlockData(crop, false);
    var event =
        new BlockPlaceEvent(
            block,
            previous,
            block.getRelative(0, -1, 0),
            item.clone(),
            player,
            true,
            EquipmentSlot.HAND);
    Bukkit.getPluginManager().callEvent(event);
    if (event.isCancelled() || !event.canBuild()) {
      previous.update(true, false);
      return false;
    }
    if (!item.equals(player.getInventory().getItem(seed.get()))
        || block.getType() != Material.WHEAT) {
      previous.update(true, false);
      throw new IllegalStateException("planting changed during event delivery");
    }
    item.subtract();
    player.getInventory().setItem(seed.get(), item);
    block.setBlockData(crop, true);
    player.swingMainHand();
    audit.placed(owner, block.getLocation(), Material.WHEAT, crop);
    return true;
  }

  static Optional<Integer> slot(Player player, Material material) {
    for (var index = 0; index < 36; index++) {
      var item = player.getInventory().getItem(index);
      if (item != null && item.getType() == material && item.getAmount() > 0)
        return Optional.of(index);
    }
    return Optional.empty();
  }

  public static void equip(Player player, Material material) {
    var slot = slot(player, material);
    if (slot.isEmpty() || slot.get() == player.getInventory().getHeldItemSlot()) return;
    var held = player.getInventory().getItemInMainHand();
    var desired = player.getInventory().getItem(slot.get());
    player.getInventory().setItemInMainHand(desired);
    player.getInventory().setItem(slot.get(), held);
  }

  static Optional<Location> approach(Player player, Block target) {
    var here = requireNonNull(player.getLocation());
    var center = target.getLocation();
    center.setY(here.getY());
    return NearbyBlocks.box(center, 3, 1)
        .filter(SurvivalActions::walkable)
        .map(block -> block.getLocation().add(0.5, 0, 0.5))
        .filter(spot -> visibleFrom(player, target, spot))
        .min(java.util.Comparator.comparingDouble(spot -> spot.distanceSquared(here)));
  }

  private static boolean walkable(Block feet) {
    return feet.getY() > feet.getWorld().getMinHeight()
        && feet.getY() + 1 < feet.getWorld().getMaxHeight()
        && feet.isPassable()
        && feet.getRelative(0, 1, 0).isPassable()
        && feet.getRelative(0, -1, 0).getType().isSolid();
  }

  private static boolean visibleFrom(Player player, Block target, Location spot) {
    if (org.bukkit.util.BoundingBox.of(target)
        .overlaps(
            new org.bukkit.util.BoundingBox(
                spot.getX() - 0.3,
                spot.getY(),
                spot.getZ() - 0.3,
                spot.getX() + 0.3,
                spot.getY() + 1.8,
                spot.getZ() + 0.3))) return false;
    var eye = spot.clone().add(0, player.getEyeHeight(), 0);
    var aim = target.getLocation().add(0.5, 0.5, 0.5);
    var distance = eye.distance(aim);
    if (eye.distanceSquared(aim) > 20.25) return false;
    var direction = aim.subtract(eye).toVector().normalize();
    var ray = player.getWorld().rayTraceBlocks(eye, direction, distance);
    return ray == null || target.equals(ray.getHitBlock());
  }
}
