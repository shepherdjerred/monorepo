package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import com.shepherdjerred.thestorm.towns.domain.world.WorldEffect;
import org.bukkit.Material;
import org.bukkit.entity.EnderDragon;
import org.bukkit.entity.Enderman;
import org.bukkit.entity.Entity;
import org.bukkit.entity.FallingBlock;
import org.bukkit.entity.Raider;
import org.bukkit.entity.Silverfish;
import org.bukkit.entity.Wither;
import org.bukkit.entity.Zombie;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockReceiveGameEvent;
import org.bukkit.event.block.EntityBlockFormEvent;
import org.bukkit.event.entity.EntityBreakDoorEvent;
import org.bukkit.event.entity.EntityChangeBlockEvent;
import org.bukkit.event.entity.EntityInteractEvent;
import org.bukkit.event.raid.RaidTriggerEvent;

/**
 * Entities changing and pressing blocks: players with tools (stripping, waxing, scraping, lighting
 * campfires), endermen, ravagers and other raiders, withers, silverfish, the dragon and every
 * door-breaking mob; falling blocks landing across a border; arrows, thrown items, mobs and mounts
 * pressing buttons, plates and tripwire or trampling farmland and turtle eggs; frost walker;
 * players setting off sculk shriekers; and raids started on someone else's land.
 */
final class MobListener implements Listener {

  private final Guard guard;
  private final BlockKinds kinds;

  MobListener(Guard guard, BlockKinds kinds) {
    this.guard = guard;
    this.kinds = kinds;
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onChangeBlock(EntityChangeBlockEvent event) {
    var entity = event.getEntity();
    var block = event.getBlock();
    var land = guard.land(block);
    if (event instanceof EntityBreakDoorEvent) {
      // Every door a mob breaks is griefing, whoever the mob belongs to.
      event.setCancelled(!Guard.flows(WorldEffect.MOB_GRIEF, guard.land(entity), land));
      return;
    }
    var culprit = guard.culprit(entity);
    if (culprit.isPresent()) {
      var act = new Act(Action.BUILD, kinds.subject(block.getType()));
      event.setCancelled(!guard.permits(culprit.get(), act, land));
      return;
    }
    if (entity instanceof FallingBlock) {
      event.setCancelled(
          !Guard.flows(WorldEffect.FALLING_BLOCK, guard.land(Origins.of(entity)), land));
      return;
    }
    if (isGriefer(entity)) {
      event.setCancelled(!Guard.flows(WorldEffect.MOB_GRIEF, guard.land(entity), land));
    }
  }

  /**
   * An entity pressing a button, plate or tripwire, or trampling farmland or turtle eggs. A player
   * behind it (an arrow's shooter, an item's thrower, a rider, a lead holder, a pet's owner) needs
   * the land to let them do it; otherwise it must have come from the same owner's land, and
   * trampling by mobs is mob griefing.
   */
  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onEntityInteract(EntityInteractEvent event) {
    var block = event.getBlock();
    var act = kinds.press(block.getType());
    if (act.isEmpty()) {
      return;
    }
    var entity = event.getEntity();
    var land = guard.land(block);
    var culprit = guard.presser(entity);
    boolean allowed;
    if (culprit.isPresent()) {
      allowed = guard.permitsQuietly(culprit.get(), act.get(), land);
    } else if (act.get().action() == Action.BREAK) {
      allowed = Guard.flows(WorldEffect.MOB_GRIEF, guard.land(entity), land);
    } else {
      allowed = Guard.flows(WorldEffect.PROJECTILE_IMPACT, guard.land(Origins.of(entity)), land);
    }
    if (!allowed) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onFrostWalk(EntityBlockFormEvent event) {
    var culprit = guard.culprit(event.getEntity());
    var build = new Act(Action.BUILD, Subject.BLOCK);
    if (culprit.isPresent()
        && !guard.permitsQuietly(culprit.get(), build, guard.land(event.getBlock()))) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onShriek(BlockReceiveGameEvent event) {
    var block = event.getBlock();
    if (block.getType() != Material.SCULK_SHRIEKER) {
      return;
    }
    var culprit = guard.culprit(event.getEntity());
    var use = new Act(Action.INTERACT, Subject.BLOCK);
    if (culprit.isPresent() && !guard.permitsQuietly(culprit.get(), use, guard.land(block))) {
      event.setCancelled(true);
    }
  }

  /**
   * A raid is war on the land around it: it may only start where the player may build, both at the
   * raid's centre and where they stand.
   */
  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onRaid(RaidTriggerEvent event) {
    var player = event.getPlayer();
    var build = new Act(Action.BUILD, Subject.BLOCK);
    if (!guard.permits(player, build, guard.land(event.getRaid().getLocation()))
        || !guard.permits(player, build, guard.land(player))) {
      event.setCancelled(true);
    }
  }

  /** Mobs whose block changes count as griefing, governed by the claim's mob-griefing flag. */
  private static boolean isGriefer(Entity entity) {
    return entity instanceof Enderman
        || entity instanceof Raider
        || entity instanceof Wither
        || entity instanceof Silverfish
        || entity instanceof EnderDragon
        || entity instanceof Zombie;
  }
}
