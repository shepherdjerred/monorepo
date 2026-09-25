package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import com.shepherdjerred.thestorm.towns.domain.world.Neighbourhood;
import com.shepherdjerred.thestorm.towns.domain.world.WorldEffect;
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

  private static final Act SHRIEK = new Act(Action.INTERACT, Subject.BLOCK);
  private static final Act SENSE = new Act(Action.USE_REDSTONE, Subject.REDSTONE_COMPONENT);

  private final Guard guard;
  private final BlockKinds kinds;
  private final Neighbourhood neighbourhood;
  private final int raidRadiusChunks;

  MobListener(Guard guard, BlockKinds kinds, Neighbourhood neighbourhood, int raidRadiusChunks) {
    this.guard = guard;
    this.kinds = kinds;
    this.neighbourhood = neighbourhood;
    this.raidRadiusChunks = raidRadiusChunks;
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
    // Players answerable for it: whoever rides it or leads it, else a pet's owner, so a sheep led
    // into a town cannot eat its grass and a rabbit cannot eat its carrots.
    var controllers = guard.controllers(entity);
    if (!controllers.isEmpty()) {
      var act = new Act(Action.BUILD, kinds.subject(block.getType()));
      for (var controller : controllers) {
        if (!guard.permits(controller, act, land)) {
          event.setCancelled(true);
          return;
        }
      }
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
    var controllers = guard.controllers(entity);
    boolean allowed;
    if (!controllers.isEmpty()) {
      allowed = guard.allPermitQuietly(controllers, act.get(), land);
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

  /**
   * An outsider's vibrations (steps, projectiles, thrown items) do not set off a town's shriekers
   * or drive its sculk-sensor redstone.
   */
  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onVibration(BlockReceiveGameEvent event) {
    var block = event.getBlock();
    var use =
        switch (block.getType()) {
          case SCULK_SHRIEKER -> SHRIEK;
          case SCULK_SENSOR, CALIBRATED_SCULK_SENSOR -> SENSE;
          default -> null;
        };
    if (use == null) {
      return;
    }
    var controllers = guard.controllers(event.getEntity());
    if (!guard.allPermitQuietly(controllers, use, guard.land(block))) {
      event.setCancelled(true);
    }
  }

  /**
   * A raid is war on the land around it: it may only start where the player may build, both at the
   * raid's centre and where they stand, and with no land they have no say over (another town's
   * claim, an admin region) within the raid's reach.
   */
  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onRaid(RaidTriggerEvent event) {
    var player = event.getPlayer();
    var centre = event.getRaid().getLocation();
    var build = new Act(Action.BUILD, Subject.BLOCK);
    if (!guard.permits(player, build, guard.land(centre))
        || !guard.permits(player, build, guard.land(player))) {
      event.setCancelled(true);
      return;
    }
    var chunk =
        ChunkPos.ofBlock(Guard.world(centre).getName(), centre.getBlockX(), centre.getBlockZ());
    if (neighbourhood.foreignLandNear(player.getUniqueId(), chunk, raidRadiusChunks).isPresent()) {
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
