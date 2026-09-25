package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import com.shepherdjerred.thestorm.towns.domain.world.WorldEffect;
import java.util.Optional;
import org.bukkit.Material;
import org.bukkit.entity.EnderDragon;
import org.bukkit.entity.Enderman;
import org.bukkit.entity.Entity;
import org.bukkit.entity.FallingBlock;
import org.bukkit.entity.Player;
import org.bukkit.entity.Ravager;
import org.bukkit.entity.Silverfish;
import org.bukkit.entity.Wither;
import org.bukkit.entity.Zombie;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockReceiveGameEvent;
import org.bukkit.event.block.EntityBlockFormEvent;
import org.bukkit.event.entity.EntityChangeBlockEvent;
import org.bukkit.event.entity.EntityInteractEvent;

/**
 * Entities changing blocks: players with tools (stripping, waxing, scraping, lighting campfires),
 * endermen, ravagers, withers, silverfish, the dragon and door-breaking zombies, falling blocks
 * landing across a border, mobs and ridden animals trampling farmland and turtle eggs, frost
 * walker, and players setting off sculk shriekers.
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
    var player = Culprits.behind(entity);
    if (player.isPresent()) {
      var act = new Act(Action.BUILD, kinds.subject(block.getType()));
      event.setCancelled(!guard.permits(player.get(), act, land));
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

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onTrample(EntityInteractEvent event) {
    var block = event.getBlock();
    var type = block.getType();
    if (type != Material.FARMLAND && type != Material.TURTLE_EGG) {
      return;
    }
    var entity = event.getEntity();
    var land = guard.land(block);
    var rider = rider(entity);
    var allowed =
        rider.isPresent()
            ? guard.permitsQuietly(rider.get(), new Act(Action.BREAK, kinds.subject(type)), land)
            : Guard.flows(WorldEffect.MOB_GRIEF, guard.land(entity), land);
    if (!allowed) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onFrostWalk(EntityBlockFormEvent event) {
    var player = Culprits.behind(event.getEntity());
    var build = new Act(Action.BUILD, Subject.BLOCK);
    if (player.isPresent()
        && !guard.permitsQuietly(player.get(), build, guard.land(event.getBlock()))) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onShriek(BlockReceiveGameEvent event) {
    var block = event.getBlock();
    if (block.getType() != Material.SCULK_SHRIEKER) {
      return;
    }
    var player = Culprits.behind(event.getEntity());
    var use = new Act(Action.INTERACT, Subject.BLOCK);
    if (player.isPresent() && !guard.permitsQuietly(player.get(), use, guard.land(block))) {
      event.setCancelled(true);
    }
  }

  private static Optional<Player> rider(Entity entity) {
    return entity.getPassengers().stream()
        .filter(Player.class::isInstance)
        .map(Player.class::cast)
        .findFirst();
  }

  /** Mobs whose block changes count as griefing, governed by the claim's mob-griefing flag. */
  private static boolean isGriefer(Entity entity) {
    return entity instanceof Enderman
        || entity instanceof Ravager
        || entity instanceof Wither
        || entity instanceof Silverfish
        || entity instanceof EnderDragon
        || entity instanceof Zombie;
  }
}
