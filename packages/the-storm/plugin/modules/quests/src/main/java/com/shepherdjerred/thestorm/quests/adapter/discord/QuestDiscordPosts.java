package com.shepherdjerred.thestorm.quests.adapter.discord;

import com.shepherdjerred.thestorm.core.players.Humans;
import com.shepherdjerred.thestorm.core.players.PlayerVisibility;
import com.shepherdjerred.thestorm.discord.app.DiscordRelay;
import com.shepherdjerred.thestorm.quests.app.QuestMilestone;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.Server;

/**
 * Posts quest milestones of online, visible players to Discord. Main thread; failures are logged,
 * never thrown.
 */
public final class QuestDiscordPosts {

  private final DiscordRelay relay;
  private final Server server;
  private final ComponentLogger logger;

  public QuestDiscordPosts(DiscordRelay relay, Server server, ComponentLogger logger) {
    this.relay = relay;
    this.server = server;
    this.logger = logger;
  }

  public void accept(QuestMilestone milestone) {
    try {
      var player = server.getPlayer(milestone.player());
      if (player == null || !Humans.isHuman(player) || PlayerVisibility.hidden(player)) {
        return;
      }
      relay.onQuestMilestone(player.getName(), milestone.quest());
    } catch (RuntimeException e) {
      logger.error(Component.text("quests: posting a milestone to Discord failed"), e);
    }
  }
}
