package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import io.papermc.paper.event.block.PlayerShearBlockEvent;
import io.papermc.paper.event.player.PlayerFlowerPotManipulateEvent;
import io.papermc.paper.event.player.PlayerInsertLecternBookEvent;
import io.papermc.paper.event.player.PlayerLecternPageChangeEvent;
import io.papermc.paper.event.player.PlayerOpenSignEvent;
import org.bukkit.block.Block;
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
    check(event, event.getPlayer(), new Act(Action.BREAK, kinds.subject(block.getType())), block);
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
    // A chest placed beside another joins it; only someone who may open that one may join it.
    Chests.partner(block)
        .filter(partner -> !event.isCancelled())
        .ifPresent(
            partner ->
                check(event, player, new Act(Action.OPEN_CONTAINER, Subject.CONTAINER), partner));
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
    Culprits.behind(event.getEntity())
        .ifPresent(
            player -> check(event, player, new Act(Action.BUILD, Subject.BLOCK), event.getBlock()));
  }

  private void check(Cancellable event, Player player, Act act, Block block) {
    if (!guard.permits(player, act, guard.land(block))) {
      event.setCancelled(true);
    }
  }
}
