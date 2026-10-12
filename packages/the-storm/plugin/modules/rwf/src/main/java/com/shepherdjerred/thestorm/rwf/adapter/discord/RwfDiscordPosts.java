package com.shepherdjerred.thestorm.rwf.adapter.discord;

import com.shepherdjerred.thestorm.discord.app.DiscordRelay;
import com.shepherdjerred.thestorm.discord.app.RwfMatchResult;
import com.shepherdjerred.thestorm.rwf.app.MatchHeadlines;
import com.shepherdjerred.thestorm.rwf.app.MatchNotification;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import java.util.Map;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;

/** Posts match headlines to Discord. Main thread; failures are logged, never thrown. */
public final class RwfDiscordPosts {

  private final MatchHeadlines headlines = new MatchHeadlines();
  private final DiscordRelay relay;
  private final Map<String, String> mapNames;
  private final ComponentLogger logger;

  /**
   * @param mapNames every map id the match can choose, to its display name
   */
  public RwfDiscordPosts(DiscordRelay relay, Map<String, String> mapNames, ComponentLogger logger) {
    this.relay = relay;
    this.mapNames = Map.copyOf(mapNames);
    this.logger = logger;
  }

  public void accept(MatchNotification notification) {
    try {
      headlines.accept(notification).ifPresent(this::post);
      relay.onActivity("rwf", MatchHeadlines.activity(notification.after()));
    } catch (RuntimeException e) {
      logger.error(Component.text("rwf: posting a match to Discord failed"), e);
    }
  }

  private void post(MatchHeadlines.Headline headline) {
    switch (headline) {
      case MatchHeadlines.Headline.LobbyOpened(var player) -> relay.onRwfLobbyOpened(player);
      case MatchHeadlines.Headline.Finished finished ->
          relay.onRwfMatchEnded(
              new RwfMatchResult(
                  mapName(finished.mapId()),
                  finished.winner().map(TeamColor::displayName),
                  finished.winners(),
                  finished.players(),
                  finished.length()));
    }
  }

  private String mapName(String id) {
    var name = mapNames.get(id);
    if (name == null) {
      throw new IllegalStateException("match ended on unknown map " + id);
    }
    return name;
  }
}
