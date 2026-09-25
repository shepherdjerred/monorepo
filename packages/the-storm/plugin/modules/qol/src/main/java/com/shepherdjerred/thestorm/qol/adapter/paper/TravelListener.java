package com.shepherdjerred.thestorm.qol.adapter.paper;

import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.player.PlayerMoveEvent;

/** Cancels a random teleport when the player moves or takes damage during the warmup. */
final class TravelListener implements Listener {

  private final RtpFlow flow;

  TravelListener(RtpFlow flow) {
    this.flow = flow;
  }

  @EventHandler
  public void onMove(PlayerMoveEvent event) {
    flow.moved(event.getPlayer());
  }

  @EventHandler
  public void onDamage(EntityDamageEvent event) {
    if (event.getEntity() instanceof Player player) {
      flow.hurt(player.getUniqueId());
    }
  }
}
