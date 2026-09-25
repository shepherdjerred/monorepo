package com.shepherdjerred.thestorm.chat.adapter.paper;

import com.shepherdjerred.thestorm.chat.app.ChatOutput;
import com.shepherdjerred.thestorm.chat.app.ChatService;
import com.shepherdjerred.thestorm.chat.app.OutgoingLine;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.minimessage.MiniMessage;
import org.bukkit.Server;

/** Sends lines that do not come from a chat event: command one-shots and relayed messages. */
public final class PaperChatOutput implements ChatOutput {

  private final Server server;
  private final ChatService service;

  public PaperChatOutput(Server server, ChatService service) {
    this.server = server;
    this.service = service;
  }

  @Override
  public void deliverExternal(String miniMessage) {
    requireMainThread();
    var component = MiniMessage.miniMessage().deserialize(miniMessage);
    for (var player : server.getOnlinePlayers()) {
      if (service.receivesExternal(player.getUniqueId(), Speakers.isStaff(player))) {
        player.sendMessage(component);
      }
    }
    server.getConsoleSender().sendMessage(component);
  }

  /** Sends a player's line to everyone who receives it, and to the console. */
  void deliver(OutgoingLine line) {
    requireMainThread();
    Component component = MiniMessage.miniMessage().deserialize(service.render(line));
    for (var player : server.getOnlinePlayers()) {
      if (service.receives(line, player.getUniqueId(), Speakers.isStaff(player))) {
        player.sendMessage(component);
      }
    }
    server.getConsoleSender().sendMessage(component);
  }

  private void requireMainThread() {
    if (!server.isPrimaryThread()) {
      throw new IllegalStateException("chat lines must be delivered on the main thread");
    }
  }
}
