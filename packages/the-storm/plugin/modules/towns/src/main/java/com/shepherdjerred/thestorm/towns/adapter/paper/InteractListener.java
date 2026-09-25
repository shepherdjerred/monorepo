package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.event.Event;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerInteractEvent;

/**
 * Right-clicking, punching and stepping on blocks: containers, doors, switches, redstone, beds,
 * cake, and tools that change the block they are used on; trampling farmland and turtle eggs and
 * pressing plates and tripwires; punching out fire and the dragon egg.
 */
final class InteractListener implements Listener {

  private final Guard guard;
  private final BlockKinds kinds;

  InteractListener(Guard guard, BlockKinds kinds) {
    this.guard = guard;
    this.kinds = kinds;
  }

  @EventHandler(priority = EventPriority.LOW)
  void onInteract(PlayerInteractEvent event) {
    var block = event.getClickedBlock();
    if (block == null) {
      return;
    }
    switch (event.getAction()) {
      case RIGHT_CLICK_BLOCK -> rightClick(event, block);
      case PHYSICAL -> step(event, block);
      case LEFT_CLICK_BLOCK -> punch(event, block);
      case LEFT_CLICK_AIR, RIGHT_CLICK_AIR -> {
        // Nothing in the world is touched.
      }
    }
  }

  private void rightClick(PlayerInteractEvent event, Block block) {
    var player = event.getPlayer();
    var land = guard.land(block);
    var use = kinds.use(block.getType());
    if (use.isPresent() && !mayUse(event, block, use.get())) {
      event.setUseInteractedBlock(Event.Result.DENY);
      event.setUseItemInHand(Event.Result.DENY);
      return;
    }
    var item = event.getItem();
    if (item == null || !kinds.changesBlocks(item.getType())) {
      return;
    }
    var build = new Act(Action.BUILD, kinds.subject(block.getType()));
    // Opening an allowed door with an axe in hand should not also complain about the axe.
    var allowed =
        use.isPresent()
            ? guard.permitsQuietly(player, build, land)
            : guard.permits(player, build, land);
    if (!allowed) {
      event.setUseItemInHand(Event.Result.DENY);
    }
  }

  /** A double chest opens only if the player may open both halves. */
  private boolean mayUse(PlayerInteractEvent event, Block block, Act use) {
    var player = event.getPlayer();
    if (!guard.permits(player, use, guard.land(block))) {
      return false;
    }
    var partner = Chests.partner(block);
    return partner.isEmpty() || guard.permits(player, use, guard.land(partner.get()));
  }

  private void step(PlayerInteractEvent event, Block block) {
    kinds
        .step(block.getType())
        .filter(act -> !guard.permitsQuietly(event.getPlayer(), act, guard.land(block)))
        .ifPresent(act -> event.setUseInteractedBlock(Event.Result.DENY));
  }

  private void punch(PlayerInteractEvent event, Block block) {
    var fire = block.getRelative(event.getBlockFace());
    var punchesFire = isFire(fire.getType());
    if (!punchesFire && block.getType() != Material.DRAGON_EGG) {
      return;
    }
    var target = punchesFire ? fire : block;
    var act = new Act(Action.BREAK, Subject.BLOCK);
    if (!guard.permits(event.getPlayer(), act, guard.land(target))) {
      event.setUseInteractedBlock(Event.Result.DENY);
    }
  }

  private static boolean isFire(Material type) {
    return type == Material.FIRE || type == Material.SOUL_FIRE;
  }
}
