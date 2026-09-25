package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import io.papermc.paper.event.block.PlayerShearBlockEvent;
import io.papermc.paper.event.player.PlayerFlowerPotManipulateEvent;
import io.papermc.paper.event.player.PlayerInsertLecternBookEvent;
import io.papermc.paper.event.player.PlayerLecternPageChangeEvent;
import io.papermc.paper.event.player.PlayerOpenSignEvent;
import org.bukkit.Tag;
import org.bukkit.block.Block;
import org.bukkit.block.data.Directional;
import org.bukkit.entity.Hanging;
import org.bukkit.entity.Player;
import org.bukkit.event.Cancellable;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockMultiPlaceEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.block.CauldronLevelChangeEvent;
import org.bukkit.event.block.SignChangeEvent;
import org.bukkit.event.player.PlayerBucketEmptyEvent;
import org.bukkit.event.player.PlayerBucketFillEvent;
import org.bukkit.event.player.PlayerHarvestBlockEvent;
import org.bukkit.event.player.PlayerTakeLecternBookEvent;

/**
 * Players changing blocks directly: breaking, placing (including beds and doors that fill two
 * blocks), buckets, signs, lecterns, flower pots, shearing, harvesting and cauldrons.
 */
final class BlockListener implements Listener {

  private final Guard guard;
  private final BlockKinds kinds;

  BlockListener(Guard guard, BlockKinds kinds) {
    this.guard = guard;
    this.kinds = kinds;
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onBreak(BlockBreakEvent event) {
    var block = event.getBlock();
    var player = event.getPlayer();
    check(event, player, new Act(Action.BREAK, kinds.subject(block.getType())), block);
    if (!event.isCancelled() && !mayDropSupported(player, block)) {
      event.setCancelled(true);
    }
  }

  /**
   * Breaking a block drops what hangs on it: torches, signs, buttons and ladders beside it and item
   * frames and paintings on it. On a border those can be on someone else's land, so they must be
   * the player's to break too. Blocks away from a border (every neighbour on the same land) skip
   * the check.
   */
  private boolean mayDropSupported(Player player, Block block) {
    var own = guard.land(block);
    var border = false;
    for (var face : Redstone.FACES) {
      var neighbour = block.getRelative(face);
      var land = guard.land(neighbour);
      if (land.sameOwnerAs(own)) {
        continue;
      }
      border = true;
      var type = neighbour.getType();
      if (!type.isAir()
          && !type.isSolid()
          && !guard.permits(player, new Act(Action.BREAK, kinds.subject(type)), land)) {
        return false;
      }
    }
    return !border || mayDropHanging(player, block);
  }

  private boolean mayDropHanging(Player player, Block block) {
    var center = block.getLocation().add(0.5, 0.5, 0.5);
    for (var hanging : block.getWorld().getNearbyEntitiesByType(Hanging.class, center, 1.5)) {
      var support = hanging.getLocation().getBlock().getRelative(hanging.getAttachedFace());
      var act = new Act(Action.BREAK, EntityKinds.subject(hanging).orElse(Subject.ENTITY));
      if (support.equals(block) && !guard.permits(player, act, guard.land(hanging))) {
        return false;
      }
    }
    return true;
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onPlace(BlockPlaceEvent event) {
    var player = event.getPlayer();
    if (event instanceof BlockMultiPlaceEvent multi) {
      var act = new Act(Action.BUILD, kinds.subject(multi.getBlock().getType()));
      for (var state : multi.getReplacedBlockStates()) {
        if (!guard.permits(player, act, guard.land(state))) {
          event.setCancelled(true);
          return;
        }
      }
      return;
    }
    var block = event.getBlock();
    check(event, player, new Act(Action.BUILD, kinds.subject(block.getType())), block);
    if (!event.isCancelled() && !mayJoin(player, block)) {
      event.setCancelled(true);
    }
    if (!event.isCancelled()
        && kinds.isRedstone(block.getType())
        && !mayWire(player, block, event.getBlockAgainst())) {
      event.setCancelled(true);
    }
  }

  /**
   * A chest placed beside another joins it and a shelf joins the shelves beside it; only someone
   * who may open those may join them.
   */
  private boolean mayJoin(Player player, Block block) {
    var open = new Act(Action.OPEN_CONTAINER, Subject.CONTAINER);
    var partner = Chests.partner(block);
    if (partner.isPresent() && !guard.permits(player, open, guard.land(partner.get()))) {
      return false;
    }
    if (block.getBlockData() instanceof Directional placed
        && Tag.WOODEN_SHELVES.isTagged(block.getType())) {
      for (var shelf : Chests.shelvesBeside(block, placed.getFacing())) {
        if (!guard.permits(player, open, guard.land(shelf))) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * A redstone component or power source may only go where the player may change the redstone of
   * every block it could power, directly or through one block: every block within two steps
   * (Manhattan distance 2) of it, and the six around the block it is attached to. Otherwise a lever
   * in the wilderness drives a town's pistons, or a torch under a block beside the border powers a
   * town's door through it.
   */
  private boolean mayWire(Player player, Block block, Block against) {
    var wire = new Act(Action.USE_REDSTONE, Subject.REDSTONE_COMPONENT);
    for (var dx = -2; dx <= 2; dx++) {
      for (var dy = -2; dy <= 2; dy++) {
        for (var dz = -2; dz <= 2; dz++) {
          if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) <= 2
              && !guard.permits(player, wire, guard.land(block.getRelative(dx, dy, dz)))) {
            return false;
          }
        }
      }
    }
    for (var face : Redstone.FACES) {
      if (!guard.permits(player, wire, guard.land(against.getRelative(face)))) {
        return false;
      }
    }
    return true;
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onSignChange(SignChangeEvent event) {
    check(event, event.getPlayer(), new Act(Action.BUILD, Subject.SIGN), event.getBlock());
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onOpenSign(PlayerOpenSignEvent event) {
    if (event.getCause() == PlayerOpenSignEvent.Cause.INTERACT) {
      check(
          event,
          event.getPlayer(),
          new Act(Action.BUILD, Subject.SIGN),
          event.getSign().getBlock());
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onBucketEmpty(PlayerBucketEmptyEvent event) {
    check(event, event.getPlayer(), new Act(Action.BUILD, Subject.BLOCK), event.getBlock());
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onBucketFill(PlayerBucketFillEvent event) {
    check(event, event.getPlayer(), new Act(Action.BREAK, Subject.BLOCK), event.getBlock());
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onTakeBook(PlayerTakeLecternBookEvent event) {
    check(
        event,
        event.getPlayer(),
        new Act(Action.OPEN_CONTAINER, Subject.LECTERN),
        event.getLectern().getBlock());
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onInsertBook(PlayerInsertLecternBookEvent event) {
    check(
        event,
        event.getPlayer(),
        new Act(Action.OPEN_CONTAINER, Subject.LECTERN),
        event.getBlock());
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onTurnPage(PlayerLecternPageChangeEvent event) {
    check(
        event,
        event.getPlayer(),
        new Act(Action.USE_REDSTONE, Subject.LECTERN),
        event.getLectern().getBlock());
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onFlowerPot(PlayerFlowerPotManipulateEvent event) {
    check(event, event.getPlayer(), new Act(Action.BUILD, Subject.BLOCK), event.getFlowerpot());
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onShearBlock(PlayerShearBlockEvent event) {
    check(event, event.getPlayer(), new Act(Action.BUILD, Subject.BLOCK), event.getBlock());
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onHarvest(PlayerHarvestBlockEvent event) {
    check(
        event, event.getPlayer(), new Act(Action.BREAK, Subject.BLOCK), event.getHarvestedBlock());
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onCauldron(CauldronLevelChangeEvent event) {
    guard
        .culprit(event.getEntity())
        .filter(
            culprit ->
                !guard.permits(
                    culprit, new Act(Action.BUILD, Subject.BLOCK), guard.land(event.getBlock())))
        .ifPresent(culprit -> event.setCancelled(true));
  }

  private void check(Cancellable event, Player player, Act act, Block block) {
    if (!guard.permits(player, act, guard.land(block))) {
      event.setCancelled(true);
    }
  }
}
