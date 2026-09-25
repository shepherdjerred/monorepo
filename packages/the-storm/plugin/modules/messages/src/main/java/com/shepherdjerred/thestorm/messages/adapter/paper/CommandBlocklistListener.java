package com.shepherdjerred.thestorm.messages.adapter.paper;

import com.shepherdjerred.thestorm.core.text.HouseStyle;
import com.shepherdjerred.thestorm.messages.domain.CommandBlocklist;
import net.kyori.adventure.text.Component;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerCommandSendEvent;

/**
 * Stops players without the bypass permission from running, or tab-completing, commands that reveal
 * the server's plugins and version.
 */
public final class CommandBlocklistListener implements Listener {

  private final CommandBlocklist blocklist;
  private final String bypassPermission;
  private final Component blockedMessage;

  public CommandBlocklistListener(
      CommandBlocklist blocklist, String bypassPermission, Component blockedMessage) {
    this.blocklist = blocklist;
    this.bypassPermission = bypassPermission;
    this.blockedMessage = blockedMessage;
  }

  @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
  public void onCommand(PlayerCommandPreprocessEvent event) {
    if (restricted(event.getPlayer()) && blocklist.blocksMessage(event.getMessage())) {
      event.setCancelled(true);
      event.getPlayer().sendMessage(HouseStyle.error("Server", blockedMessage));
    }
  }

  @EventHandler
  public void onCommandList(PlayerCommandSendEvent event) {
    if (restricted(event.getPlayer())) {
      event.getCommands().removeIf(blocklist::blocks);
    }
  }

  private boolean restricted(Player player) {
    return !player.hasPermission(bypassPermission);
  }
}
