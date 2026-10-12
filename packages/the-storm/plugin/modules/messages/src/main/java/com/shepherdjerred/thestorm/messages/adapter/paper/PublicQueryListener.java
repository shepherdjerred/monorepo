package com.shepherdjerred.thestorm.messages.adapter.paper;

import com.destroystokyo.paper.event.server.GS4QueryEvent;
import com.destroystokyo.paper.event.server.GS4QueryEvent.QueryResponse.PluginInformation;
import com.shepherdjerred.thestorm.core.players.Humans;
import com.shepherdjerred.thestorm.core.players.PlayerVisibility;
import com.shepherdjerred.thestorm.core.status.PublicGameDirectory;
import com.shepherdjerred.thestorm.messages.domain.PublicRoster;
import java.util.Base64;
import java.util.Collection;
import java.util.List;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.json.JsonMapper;

/** Only public humans may appear in the forum's private Query feed. */
public final class PublicQueryListener implements Listener {
  private static final JsonMapper JSON = JsonMapper.builder().build();
  private final PublicRoster roster = new PublicRoster();
  private final String identity;
  private final PublicGameDirectory games;

  public PublicQueryListener(
      String identity, Collection<? extends Player> online, PublicGameDirectory games) {
    this.identity = identity;
    this.games = games;
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
    var players = roster.players(restored, PlayerVisibility::hidden);
    var directory = restored ? games.snapshot() : List.<PublicGameDirectory.Game>of();
    var metadata = encode(new PublicStatus(players, directory));
    event.setResponse(
        event.getResponse().toBuilder()
            .clearPlayers()
            .players(players.stream().map(PublicRoster.Player::name).toList())
            .currentPlayers(players.size())
            .clearPlugins()
            .plugins(PluginInformation.of(identity + "|" + metadata, ""))
            .build());
  }

  private static String encode(PublicStatus status) {
    try {
      return Base64.getUrlEncoder().withoutPadding().encodeToString(JSON.writeValueAsBytes(status));
    } catch (JacksonException error) {
      throw new IllegalStateException("Could not encode the public Minecraft status", error);
    }
  }

  private record PublicStatus(
      int schemaVersion, List<PublicRoster.Player> players, List<PublicGameDirectory.Game> games) {
    PublicStatus(List<PublicRoster.Player> players, List<PublicGameDirectory.Game> games) {
      this(2, List.copyOf(players), List.copyOf(games));
    }
  }
}
