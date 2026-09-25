package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.essentials.domain.back.BackEntry;
import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerRespawnEvent;

/**
 * Cancels warmups on movement and damage, records death spots for {@code /back}, and sends players
 * without a bed or anchor back to spawn when they respawn.
 */
final class TeleportListener implements Listener {

  private final PaperRuntime runtime;
  private final TeleportFlow flow;
  private final BackRecorder back;
  private final Position spawn;

  TeleportListener(PaperRuntime runtime, TeleportFlow flow, BackRecorder back, Position spawn) {
    this.runtime = runtime;
    this.flow = flow;
    this.back = back;
    this.spawn = spawn;
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onMove(PlayerMoveEvent event) {
    if (event.hasChangedBlock()) {
      flow.moved(event.getPlayer(), event.getTo());
    }
  }

  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  void onDamage(EntityDamageEvent event) {
    if (event.getEntity() instanceof Player player) {
      flow.damaged(player);
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onDeath(PlayerDeathEvent event) {
    var player = event.getPlayer();
    back.record(player.getUniqueId(), Positions.of(player), BackEntry.Cause.DEATH);
  }

  @EventHandler(priority = EventPriority.HIGH)
  void onRespawn(PlayerRespawnEvent event) {
    if (event.getRespawnReason() != PlayerRespawnEvent.RespawnReason.DEATH
        || event.isBedSpawn()
        || event.isAnchorSpawn()) {
      return;
    }
    Positions.toLocation(runtime.server(), spawn).ifPresent(event::setRespawnLocation);
  }
}
