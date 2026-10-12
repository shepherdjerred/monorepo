package com.shepherdjerred.thestorm.rwf.adapter.paper;

import java.util.Optional;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;

/**
 * The world's damage to an ally a Sacrificial shields (a fall, fire, a blast) goes to the
 * Sacrificial instead; hits from players go through {@link CombatListener}. Main thread only.
 */
final class SacrificeListener implements Listener {

  private final PaperContext context;
  private final Sacrifices sacrifices;

  SacrificeListener(MatchRunner runner, PaperContext context, CombatTracker tracker) {
    this.context = context;
    this.sacrifices = new Sacrifices(runner, context, tracker);
  }

  @EventHandler(ignoreCancelled = true, priority = EventPriority.HIGH)
  void onWorldDamage(EntityDamageEvent event) {
    if (event instanceof EntityDamageByEntityEvent
        || !(event.getEntity() instanceof Player ally)
        || !ally.getWorld().equals(context.mapWorld())) {
      return;
    }
    var sac = sacrifices.guardian(ally, CombatListener.cause(event));
    if (sac.isEmpty()) {
      return;
    }
    event.setCancelled(true);
    sacrifices.take(
        Optional.empty(),
        ally,
        sac.orElseThrow(),
        new Sacrifices.Meant(CombatListener.cause(event), event.getDamage(), Optional.empty()));
  }
}
