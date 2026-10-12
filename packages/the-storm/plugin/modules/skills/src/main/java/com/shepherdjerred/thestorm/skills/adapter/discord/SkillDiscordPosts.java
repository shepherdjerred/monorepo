package com.shepherdjerred.thestorm.skills.adapter.discord;

import com.shepherdjerred.thestorm.core.players.Humans;
import com.shepherdjerred.thestorm.core.players.PlayerVisibility;
import com.shepherdjerred.thestorm.discord.app.DiscordRelay;
import com.shepherdjerred.thestorm.skills.app.SkillLevelUp;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;
import org.bukkit.Server;

/**
 * Hands level ups of online, visible players to the Discord relay, which posts the milestones. Main
 * thread; failures are logged, never thrown.
 */
public final class SkillDiscordPosts {

  private final DiscordRelay relay;
  private final Server server;
  private final ComponentLogger logger;

  public SkillDiscordPosts(DiscordRelay relay, Server server, ComponentLogger logger) {
    this.relay = relay;
    this.server = server;
    this.logger = logger;
  }

  public void accept(SkillLevelUp levelUp) {
    try {
      var player = server.getPlayer(levelUp.player());
      if (player == null || !Humans.isHuman(player) || PlayerVisibility.hidden(player)) {
        return;
      }
      relay.onSkillLevelUp(
          player.getName(), levelUp.skill().displayName(), levelUp.from(), levelUp.to());
    } catch (RuntimeException e) {
      logger.error(Component.text("skills: posting a level up to Discord failed"), e);
    }
  }
}
