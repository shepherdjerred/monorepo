package com.shepherdjerred.thestorm.tracks.adapter.paper;

import com.shepherdjerred.thestorm.tracks.app.TrackSessions;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;

/** Loads a player's tracks when they join and drops them, and any open confirmation, on quit. */
final class SessionListener implements Listener {

  private final TrackSessions sessions;
  private final PerksCommands commands;

  SessionListener(TrackSessions sessions, PerksCommands commands) {
    this.sessions = sessions;
    this.commands = commands;
  }

  @EventHandler(priority = EventPriority.LOWEST)
  void onJoin(PlayerJoinEvent event) {
    sessions.joined(event.getPlayer().getUniqueId());
  }

  @EventHandler(priority = EventPriority.MONITOR)
  void onQuit(PlayerQuitEvent event) {
    var player = event.getPlayer().getUniqueId();
    sessions.quit(player);
    commands.forget(player);
  }
}
