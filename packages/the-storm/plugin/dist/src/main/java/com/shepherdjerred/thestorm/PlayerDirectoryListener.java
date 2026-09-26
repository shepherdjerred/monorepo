package com.shepherdjerred.thestorm;

import com.shepherdjerred.thestorm.core.players.SqlPlayerDirectory;
import java.time.InstantSource;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;

/** Records every join in the player directory, off the main thread. */
final class PlayerDirectoryListener implements Listener {

  private final SqlPlayerDirectory players;
  private final InstantSource time;
  private final ComponentLogger logger;

  PlayerDirectoryListener(SqlPlayerDirectory players, InstantSource time, ComponentLogger logger) {
    this.players = players;
    this.time = time;
    this.logger = logger;
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onJoin(PlayerJoinEvent event) {
    var player = event.getPlayer();
    var name = player.getName();
    var _ =
        players
            .recordJoin(player.getUniqueId(), name, time.instant())
            .whenComplete(
                (done, failure) -> {
                  if (failure != null) {
                    logger.error("Could not record {} in the player directory", name, failure);
                  }
                });
  }
}
