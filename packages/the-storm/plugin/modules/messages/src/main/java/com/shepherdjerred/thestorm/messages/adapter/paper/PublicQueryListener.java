package com.shepherdjerred.thestorm.messages.adapter.paper;

import com.destroystokyo.paper.event.server.GS4QueryEvent;
import com.shepherdjerred.thestorm.core.players.Humans;
import com.shepherdjerred.thestorm.core.players.PlayerVisibility;
import com.shepherdjerred.thestorm.messages.domain.PublicRoster;
import java.util.Collection;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;

/** Only public humans may appear in the forum's private Query feed. */
public final class PublicQueryListener implements Listener {
  private final PublicRoster roster = new PublicRoster();
  private final String identity;

  public PublicQueryListener(String identity, Collection<? extends Player> online) {
    this.identity = identity;
    online.forEach(this::joined);
  }

  private void joined(Player player) {
    roster.joined(player.getUniqueId(), player.getName(), Humans.isHuman(player));
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onJoin(PlayerJoinEvent event) {
    joined(event.getPlayer());
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onQuit(PlayerQuitEvent event) {
    roster.left(event.getPlayer().getUniqueId());
  }

  @EventHandler(priority = EventPriority.HIGHEST)
  public void onQuery(GS4QueryEvent event) {
    var restored = PlayerVisibility.restored();
    var names = roster.names(restored, PlayerVisibility::hidden);
    event.setResponse(
        event.getResponse().toBuilder()
            .clearPlayers()
            .players(names)
            .currentPlayers(names.size())
            .clearPlugins()
            .serverVersion(restored ? identity : identity + " (initializing)")
            .build());
  }
}
