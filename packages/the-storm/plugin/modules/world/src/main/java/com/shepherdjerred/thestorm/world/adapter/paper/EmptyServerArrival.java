package com.shepherdjerred.thestorm.world.adapter.paper;

import com.shepherdjerred.thestorm.core.players.Humans;
import org.bukkit.Server;
import org.bukkit.World;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;

/** Starts an empty server with a clear morning when its first human arrives. */
public final class EmptyServerArrival implements Listener {
  private static final long MORNING = 1000;
  private final Server server;

  public EmptyServerArrival(Server server) {
    this.server = server;
  }

  @EventHandler
  void onJoin(PlayerJoinEvent event) {
    var joining = event.getPlayer();
    if (!Humans.isHuman(joining)) return;
    var occupied =
        server.getOnlinePlayers().stream()
            .filter(Humans::isHuman)
            .anyMatch(player -> !player.getUniqueId().equals(joining.getUniqueId()));
    if (occupied) return;
    for (var world : server.getWorlds()) {
      if (world.getEnvironment() != World.Environment.NORMAL) continue;
      world.setTime(MORNING);
      world.setStorm(false);
      world.setThundering(false);
    }
  }
}
