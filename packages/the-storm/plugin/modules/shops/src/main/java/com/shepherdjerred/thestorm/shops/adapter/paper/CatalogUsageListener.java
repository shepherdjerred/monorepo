package com.shepherdjerred.thestorm.shops.adapter.paper;

import com.shepherdjerred.thestorm.shops.app.Background;
import com.shepherdjerred.thestorm.shops.app.DailyUsage;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;

/** Reads a joining player's catalog trades for today, so their first NPC shop opens promptly. */
final class CatalogUsageListener implements Listener {

  private final DailyUsage usage;
  private final ComponentLogger logger;

  CatalogUsageListener(DailyUsage usage, ComponentLogger logger) {
    this.usage = usage;
    this.logger = logger;
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onJoin(PlayerJoinEvent event) {
    Background.logFailure(
        usage.preload(event.getPlayer().getUniqueId()),
        logger,
        "load catalog usage for " + event.getPlayer().getName());
  }
}
