package com.shepherdjerred.thestorm.discord.adapter.paper;

import com.shepherdjerred.thestorm.core.players.Humans;
import com.shepherdjerred.thestorm.core.players.PlayerVisibility;
import com.shepherdjerred.thestorm.discord.app.DiscordRelay;
import com.shepherdjerred.thestorm.towns.app.TownMilestones;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.Server;

/**
 * Posts saved town foundings and growth. A town founded by a hidden or offline founder is not
 * announced. Main thread; failures are logged, never thrown.
 */
public final class TownMilestonePosts {

  private final DiscordRelay relay;
  private final Server server;
  private final ComponentLogger logger;

  public TownMilestonePosts(DiscordRelay relay, Server server, ComponentLogger logger) {
    this.relay = relay;
    this.server = server;
    this.logger = logger;
  }

  public void accept(TownMilestones.Milestone milestone) {
    try {
      switch (milestone) {
        case TownMilestones.Milestone.Founded(var town, var founder) -> {
          var player = server.getPlayer(founder);
          if (player != null && Humans.isHuman(player) && !PlayerVisibility.hidden(player)) {
            relay.onTownFounded(town, player.getName());
          }
        }
        case TownMilestones.Milestone.Grew(var townId, var town, var claims) ->
            relay.onTownGrew(townId, town, claims);
      }
    } catch (RuntimeException e) {
      logger.error(Component.text("discord: posting a town milestone failed"), e);
    }
  }
}
