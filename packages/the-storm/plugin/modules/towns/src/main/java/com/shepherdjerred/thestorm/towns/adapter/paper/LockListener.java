package com.shepherdjerred.thestorm.towns.adapter.paper;

import static java.util.UUID.randomUUID;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.app.Change;
import com.shepherdjerred.thestorm.towns.app.LockService;
import com.shepherdjerred.thestorm.towns.domain.land.BlockPos;
import com.shepherdjerred.thestorm.towns.domain.lock.Lock;
import com.shepherdjerred.thestorm.towns.domain.lock.LockAttempt;
import com.shepherdjerred.thestorm.towns.domain.lock.LockProblem;
import io.papermc.paper.event.entity.ItemTransportingEntityValidateTargetEvent;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;
import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockBurnEvent;
import org.bukkit.event.block.BlockDispenseEvent;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.block.BlockMultiPlaceEvent;
import org.bukkit.event.block.BlockPistonExtendEvent;
import org.bukkit.event.block.BlockPistonRetractEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.block.CrafterCraftEvent;
import org.bukkit.event.entity.EntityChangeBlockEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.inventory.InventoryMoveItemEvent;
import org.bukkit.event.player.PlayerInteractEvent;

/**
 * Locked containers, on any land: only their owner, the players they trust and (by config) their
 * town mates open or break them; items move in or out only between ends one owner locked;
 * explosions, pistons, fire and mobs never destroy them; nobody else places a container, hopper or
 * redstone where it would reach into them. A lock follows its blocks: breaking one releases it, and
 * a double chest its owner completes is locked whole.
 */
final class LockListener implements Listener {

  /** How far (Manhattan) a redstone component can reach a dispenser, dropper or crafter. */
  private static final int WIRE_REACH = 2;

  private final LockGuard locks;
  private final LockService service;
  private final BlockKinds kinds;
  private final Placers placers;
  private final Map<BlockPos, UUID> pendingAutoLocks = new HashMap<>();

  LockListener(LockGuard locks, LockService service, BlockKinds kinds, Placers placers) {
    this.locks = locks;
    this.service = service;
    this.kinds = kinds;
    this.placers = placers;
  }

  @EventHandler(priority = EventPriority.LOW)
  void onInteract(PlayerInteractEvent event) {
    var block = event.getClickedBlock();
    if (block == null
        || event.getAction() != Action.RIGHT_CLICK_BLOCK
        || !kinds.isLockable(block.getType())) {
      return;
    }
    var blocks = new ArrayList<>(LockGuard.container(block));
    blocks.addAll(Chests.shelfChain(block));
    if (!locks.mayOpen(event.getPlayer(), blocks)) {
      event.setUseInteractedBlock(Event.Result.DENY);
      event.setUseItemInHand(Event.Result.DENY);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onBreak(BlockBreakEvent event) {
    if (!locks.mayBreak(event.getPlayer(), List.of(event.getBlock()))) {
      event.setCancelled(true);
    }
  }

  /** The block is gone, so whatever lock covered it no longer does. */
  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onBroken(BlockBreakEvent event) {
    pendingAutoLocks.remove(LockGuard.position(event.getBlock()));
    if (locks.lockOf(event.getBlock()) != null) {
      service.release(LockGuard.position(event.getBlock()));
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onPlace(BlockPlaceEvent event) {
    if (event instanceof BlockMultiPlaceEvent) {
      return;
    }
    var block = event.getBlock();
    var player = event.getPlayer();
    var type = block.getType();
    if (kinds.isLockable(type) && service.policy().autoLockOnPlace() && service.isSettling()) {
      player.sendMessage(
          Notices.error("Locks are saving; try placing the container again shortly."));
      event.setCancelled(true);
      return;
    }
    if (kinds.isLockable(type) && !mayPlaceBeside(player, block)) {
      event.setCancelled(true);
      return;
    }
    var partner = Chests.partner(block);
    if (kinds.isLockable(type)
        && service.policy().autoLockOnPlace()
        && partner.isPresent()
        && locks.lockOf(partner.get()) == null
        && !player.getUniqueId().equals(placers.placedBy(partner.get()))) {
      player.sendMessage(
          Notices.error("That chest belongs to someone else; place yours separately."));
      event.setCancelled(true);
      return;
    }
    if (kinds.isLockable(type)
        && service.policy().autoLockOnPlace()
        && service.book().countOf(player.getUniqueId()) >= service.policy().maxPerPlayer()
        && Chests.partner(block).map(locks::lockOf).orElse(null) == null) {
      player.sendMessage(
          Notices.error("Your lock limit is full; unlock a container before placing another."));
      event.setCancelled(true);
      return;
    }
    if (kinds.isRedstone(type) && !mayWireNear(player, block)) {
      event.setCancelled(true);
    }
  }

  /**
   * A container placed where a lock was left behind clears it; a placed lockable remembers who
   * placed it; and a chest completing its owner's locked chest is locked with it.
   */
  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onPlaced(BlockPlaceEvent event) {
    var block = event.getBlock();
    var position = LockGuard.position(block);
    if (service.book().lockAt(position).isPresent()) {
      service.release(position);
    }
    if (!kinds.isLockable(block.getType())) {
      return;
    }
    placers.record(block, event.getPlayer().getUniqueId());
    var partner = Chests.partner(block);
    if (partner.isPresent()) {
      var lock = locks.lockOf(partner.get());
      if (lock != null && locks.mayBreak(event.getPlayer(), lock, partner.get())) {
        service.extend(lock, position);
        return;
      }
    }
    if (!service.policy().autoLockOnPlace()) {
      return;
    }
    var blocks = LockGuard.container(block).stream().map(LockGuard::position).toList();
    var standing =
        new LockAttempt.Standing(
            event.getPlayer().getUniqueId(), true, locks.ground(event.getPlayer(), block), false);
    var token = randomUUID();
    pendingAutoLocks.put(position, token);
    var result = service.lock(event.getPlayer().getUniqueId(), blocks, standing);
    switch (result) {
      case Result.Ok<Change<Lock>, List<LockProblem>>(var change) -> {
        var _ =
            change
                .saved()
                .whenComplete(
                    (saved, failure) -> {
                      if (pendingAutoLocks.remove(position, token) && failure != null) {
                        revokeUnstoredPlacement(event.getPlayer(), block, position);
                      }
                    });
      }
      case Result.Err<Change<Lock>, List<LockProblem>>(var _) -> {
        pendingAutoLocks.remove(position, token);
        revokeUnstoredPlacement(event.getPlayer(), block, position);
      }
    }
  }

  private void revokeUnstoredPlacement(Player player, Block block, BlockPos position) {
    if (kinds.isLockable(block.getType()) && player.getUniqueId().equals(placers.placedBy(block))) {
      block.breakNaturally();
      service.release(position);
    }
    player.sendMessage(
        Notices.error("The container could not be locked and was returned; try again."));
  }

  /** No container or hopper beside someone else's locked container, where it could reach in. */
  private boolean mayPlaceBeside(Player player, Block block) {
    for (var face : Redstone.FACES) {
      if (!locks.mayBreak(player, List.of(block.getRelative(face)))) {
        return false;
      }
    }
    return true;
  }

  /** No redstone within reach of someone else's locked dispenser, dropper or crafter. */
  private boolean mayWireNear(Player player, Block block) {
    for (var dx = -WIRE_REACH; dx <= WIRE_REACH; dx++) {
      for (var dy = -WIRE_REACH; dy <= WIRE_REACH; dy++) {
        for (var dz = -WIRE_REACH; dz <= WIRE_REACH; dz++) {
          if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) <= WIRE_REACH
              && !mayWire(player, block.getRelative(dx, dy, dz))) {
            return false;
          }
        }
      }
    }
    return true;
  }

  private boolean mayWire(Player player, Block near) {
    if (!kinds.isRedstoneDriven(near.getType())) {
      return true;
    }
    return locks.mayWire(player, List.of(near));
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onItemMove(InventoryMoveItemEvent event) {
    if (!locks.mayTransfer(event.getSource(), event.getDestination())) {
      event.setCancelled(true);
    }
  }

  /** Pre-existing wiring and piston-moved power sources cannot bypass a machine's lock option. */
  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onDispense(BlockDispenseEvent event) {
    if (!locks.mayAutomate(event.getBlock())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onCrafterCraft(CrafterCraftEvent event) {
    if (!locks.mayAutomate(event.getBlock())) {
      event.setCancelled(true);
    }
  }

  /** Copper golems carry items for nobody's lock, so they never take from or fill a locked one. */
  @EventHandler(priority = EventPriority.LOW)
  void onGolemTarget(ItemTransportingEntityValidateTargetEvent event) {
    for (var block : LockGuard.container(event.getBlock())) {
      if (locks.lockOf(block) != null) {
        event.setAllowed(false);
        return;
      }
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onEntityExplode(EntityExplodeEvent event) {
    event.blockList().removeIf(block -> locks.lockOf(block) != null);
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onBlockExplode(BlockExplodeEvent event) {
    event.blockList().removeIf(block -> locks.lockOf(block) != null);
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onPistonExtend(BlockPistonExtendEvent event) {
    // The list holds the blocks the piston would destroy (a shulker box) as well as move.
    if (touchesLock(event.getBlocks())) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onPistonRetract(BlockPistonRetractEvent event) {
    if (touchesLock(event.getBlocks())) {
      event.setCancelled(true);
    }
  }

  private boolean touchesLock(List<Block> blocks) {
    return blocks.stream().anyMatch(block -> locks.lockOf(block) != null);
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onBurn(BlockBurnEvent event) {
    if (locks.lockOf(event.getBlock()) != null) {
      event.setCancelled(true);
    }
  }

  /** Withers, endermen, ravagers and every other mob leave locked blocks alone. */
  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onEntityChange(EntityChangeBlockEvent event) {
    if (locks.lockOf(event.getBlock()) != null) {
      event.setCancelled(true);
    }
  }
}
