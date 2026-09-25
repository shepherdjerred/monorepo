package com.shepherdjerred.thestorm.discord.adapter.paper;

import com.shepherdjerred.thestorm.discord.app.OnlinePlayers;
import java.util.List;
import org.bukkit.Server;
import org.bukkit.entity.Player;

/** Online players from the server. Main thread only. */
public final class PaperOnlinePlayers implements OnlinePlayers {

  private final Server server;

  public PaperOnlinePlayers(Server server) {
    this.server = server;
  }

  @Override
  public List<String> names() {
    if (!server.isPrimaryThread()) {
      throw new IllegalStateException("online players are read on the main thread");
    }
    return server.getOnlinePlayers().stream().map(Player::getName).toList();
  }
}
