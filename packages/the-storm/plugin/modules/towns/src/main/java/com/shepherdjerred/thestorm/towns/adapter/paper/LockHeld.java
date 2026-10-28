package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import com.shepherdjerred.thestorm.towns.domain.lock.LockType;
import io.papermc.paper.event.player.PlayerItemFrameChangeEvent;
import org.bukkit.entity.ArmorStand;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Item;
import org.bukkit.entity.ItemFrame;
import org.bukkit.entity.Player;
import org.bukkit.event.Cancellable;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityPlaceEvent;
import org.bukkit.event.entity.ItemSpawnEvent;
import org.bukkit.event.hanging.HangingBreakByEntityEvent;
import org.bukkit.event.hanging.HangingBreakEvent;
import org.bukkit.event.hanging.HangingPlaceEvent;
import org.bukkit.event.player.PlayerArmorStandManipulateEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.inventory.InventoryHolder;

/**
 * Item frames, armor stands, magnet pulls and drop-transfer. Split from {@link LockListener} so
 * each listener stays within the complexity limit. Main thread only.
 */
final class LockHeld implements Listener {

  private final LockListener host;

  LockHeld(LockListener host) {
    this.host = host;
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onDrop(PlayerDropItemEvent event) {
    var player = event.getPlayer();
    if (!host.service().modes().get(player.getUniqueId()).dropTransfer()) {
      return;
    }
    var block = player.getTargetBlockExact(5, org.bukkit.FluidCollisionMode.NEVER);
    if (block == null
        || !host.kinds().isLockable(block.getType())
        || !host.locks().mayOpen(player, LockGuard.container(block))
        || !(block.getState() instanceof InventoryHolder holder)) {
      return;
    }
    if (!holder.getInventory().addItem(event.getItemDrop().getItemStack()).isEmpty()) {
      return;
    }
    event.getItemDrop().remove();
    event.setCancelled(true);
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onMagnet(ItemSpawnEvent event) {
    var item = event.getEntity();
    var radius = host.service().policy().magnetRadius();
    for (var lock : host.service().book().all()) {
      if (!lock.options().flags().magnet()) {
        continue;
      }
      for (var pos : lock.blocks()) {
        if (pull(item, pos, radius)) {
          return;
        }
      }
    }
  }

  private static boolean pull(Item item, BlockPos pos, int radius) {
    var location = item.getLocation();
    var world = location.getWorld();
    if (world == null || !world.getName().equals(pos.world())) {
      return false;
    }
    if (Math.abs(location.getBlockX() - pos.x()) > radius
        || Math.abs(location.getBlockY() - pos.y()) > radius
        || Math.abs(location.getBlockZ() - pos.z()) > radius) {
      return false;
    }
    if (!(world.getBlockAt(pos.x(), pos.y(), pos.z()).getState()
        instanceof InventoryHolder holder)) {
      return false;
    }
    var leftovers = holder.getInventory().addItem(item.getItemStack());
    if (!leftovers.isEmpty()) {
      item.setItemStack(leftovers.values().iterator().next());
      return false;
    }
    item.remove();
    return true;
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onEntityUse(PlayerInteractEntityEvent event) {
    refuseUse(event, event.getPlayer(), event.getRightClicked());
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onFrameChange(PlayerItemFrameChangeEvent event) {
    refuseUse(event, event.getPlayer(), event.getItemFrame());
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onStandChange(PlayerArmorStandManipulateEvent event) {
    refuseUse(event, event.getPlayer(), event.getRightClicked());
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onStandHurt(EntityDamageByEntityEvent event) {
    if (!(event.getEntity() instanceof ArmorStand stand)) {
      return;
    }
    if (event.getDamager() instanceof Player player) {
      if (!host.locks().mayUse(player, stand, true)) {
        event.setCancelled(true);
      }
      return;
    }
    if (isExplosion(event.getCause()) && lockedAgainstExplosions(stand)) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onFrameBreak(HangingBreakEvent event) {
    if (!(event.getEntity() instanceof ItemFrame frame)) {
      return;
    }
    if (event instanceof HangingBreakByEntityEvent by && by.getRemover() instanceof Player player) {
      if (!host.locks().mayUse(player, frame, true)) {
        event.setCancelled(true);
      }
      return;
    }
    if (event.getCause() == HangingBreakEvent.RemoveCause.EXPLOSION
        && lockedAgainstExplosions(frame)) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onFrameRemoved(HangingBreakEvent event) {
    releaseKept(event.getEntity());
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onStandRemoved(EntityDamageByEntityEvent event) {
    if (event.getEntity() instanceof ArmorStand stand
        && event.getFinalDamage() >= stand.getHealth()) {
      releaseKept(stand);
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onFramePlaced(HangingPlaceEvent event) {
    var player = event.getPlayer();
    if (player != null && event.getEntity() instanceof ItemFrame frame) {
      autoLockEntity(player, frame);
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onStandPlaced(EntityPlaceEvent event) {
    var player = event.getPlayer();
    if (player != null && event.getEntity() instanceof ArmorStand stand) {
      autoLockEntity(player, stand);
    }
  }

  private void refuseUse(Cancellable event, Player player, Entity entity) {
    if (host.locks().mayUse(player, entity, false)) {
      return;
    }
    event.setCancelled(true);
    var lock = host.locks().kept(entity);
    if (lock != null
        && lock.options().type() == LockType.PASSWORD
        && !host.locks().knowsPassword(player.getUniqueId(), lock)) {
      host.locks().expectPassword(player.getUniqueId(), lock);
      player.sendMessage(
          Notices.info("Type this lock's password in chat. It lasts until you log out."));
    }
  }

  private boolean lockedAgainstExplosions(Entity entity) {
    var lock = host.locks().kept(entity);
    return lock != null && !lock.options().flags().explosions();
  }

  private static boolean isExplosion(EntityDamageEvent.DamageCause cause) {
    return cause == EntityDamageEvent.DamageCause.BLOCK_EXPLOSION
        || cause == EntityDamageEvent.DamageCause.ENTITY_EXPLOSION;
  }

  private void releaseKept(Entity entity) {
    var lock = host.locks().kept(entity);
    if (lock != null) {
      host.service().release(LockGuard.position(entity.getLocation().getBlock()));
    }
  }

  private void autoLockEntity(Player player, Entity entity) {
    if (host.locks().isSealed(entity.getWorld()) || !host.willLock(player)) {
      return;
    }
    var block = entity.getLocation().getBlock();
    var position = LockGuard.position(block);
    if (host.service().book().lockAt(position).isPresent() || host.service().isSettling()) {
      return;
    }
    if (host.service().book().countOf(player.getUniqueId())
        >= host.service().policy().maxPerPlayer()) {
      entity.remove();
      player.sendMessage(
          Notices.error("Your lock limit is full; unlock a container before placing another."));
      return;
    }
    host.autoLockPlaced(player, block, position);
  }
}
