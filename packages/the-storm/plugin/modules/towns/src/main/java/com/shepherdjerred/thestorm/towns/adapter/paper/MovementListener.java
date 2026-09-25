package com.shepherdjerred.thestorm.towns.adapter.paper;

import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import com.shepherdjerred.thestorm.towns.domain.world.WorldEffect;
import io.papermc.paper.event.block.TargetHitEvent;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.ProjectileHitEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerTeleportEvent;

/**
 * Projectiles hitting blocks (targets, buttons, plates, bells, pots, chorus, dripstone, campfires,
 * candles), arrivals by ender pearl and chorus fruit, and forgetting players who leave.
 */
final class MovementListener implements Listener {

  private final Guard guard;
  private final BlockKinds kinds;

  MovementListener(Guard guard, BlockKinds kinds) {
    this.guard = guard;
    this.kinds = kinds;
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onProjectileHit(ProjectileHitEvent event) {
    impact(event);
  }

  /** A target block fires its own event after the hit; it follows the same rule. */
  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onTargetHit(TargetHitEvent event) {
    impact(event);
  }

  private void impact(ProjectileHitEvent event) {
    var block = event.getHitBlock();
    if (block == null) {
      return;
    }
    var act = kinds.impact(block.getType());
    if (act.isEmpty()) {
      return;
    }
    var projectile = event.getEntity();
    var land = guard.land(block);
    var culprit = Culprits.behind(projectile);
    var allowed =
        culprit.isPresent()
            ? guard.permits(culprit.get(), act.get(), land)
            : Guard.flows(WorldEffect.PROJECTILE_IMPACT, guard.land(Origins.of(projectile)), land);
    if (!allowed) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.LOW, ignoreCancelled = true)
  void onTeleport(PlayerTeleportEvent event) {
    var subject =
        switch (event.getCause()) {
          case ENDER_PEARL -> Subject.ENDER_PEARL;
          case CONSUMABLE_EFFECT -> Subject.CHORUS_FRUIT;
          default -> null;
        };
    if (subject == null) {
      return;
    }
    var act = new Act(Action.TELEPORT_INTO, subject);
    if (!guard.permits(event.getPlayer(), act, guard.land(event.getTo()))) {
      event.setCancelled(true);
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onQuit(PlayerQuitEvent event) {
    guard.forget(event.getPlayer());
  }
}
