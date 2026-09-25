package com.shepherdjerred.thestorm.messages.adapter.paper;

import net.kyori.adventure.text.Component;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;

/** Sends the tab list header and footer to each player as they join. */
public final class TabListListener implements Listener {

  private final Component header;
  private final Component footer;

  public TabListListener(Component header, Component footer) {
    this.header = header;
    this.footer = footer;
  }

  @EventHandler
  public void onJoin(PlayerJoinEvent event) {
    event.getPlayer().sendPlayerListHeaderAndFooter(header, footer);
  }
}
