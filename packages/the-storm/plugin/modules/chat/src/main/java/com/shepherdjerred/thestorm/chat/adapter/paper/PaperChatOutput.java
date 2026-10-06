package com.shepherdjerred.thestorm.chat.adapter.paper;

import com.shepherdjerred.thestorm.chat.app.ChatOutput;
import com.shepherdjerred.thestorm.chat.app.ChatService;
import com.shepherdjerred.thestorm.chat.app.OutgoingLine;
import com.shepherdjerred.thestorm.chat.app.PrivateLine;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.minimessage.MiniMessage;
import org.bukkit.Server;
import org.bukkit.entity.Player;

/** Sends lines that do not come from a chat event: command one-shots and relayed messages. */
public final class PaperChatOutput implements ChatOutput {

  private final Server server;
  private final ChatService service;
  private final com.shepherdjerred.thestorm.core.module.@org.jspecify.annotations.Nullable ModuleContext
      context;

  public PaperChatOutput(Server server, ChatService service) {
    this.server = server;
    this.service = service;
    this.context = null;
  }

  public PaperChatOutput(
      com.shepherdjerred.thestorm.core.module.ModuleContext context, ChatService service) {
    this.server = context.plugin().getServer();
    this.service = service;
    this.context = context;
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

  /** Shows a private message to its sender and recipient only. */
  void deliverPrivate(PrivateLine line, Player sender, Player recipient) {
    requireMainThread();
    var component = MiniMessage.miniMessage().deserialize(service.renderPrivate(line));
    sender.sendMessage(component);
    recipient.sendMessage(component);
    var runtime = context;
    if (runtime == null) return;
    for (var viewer : server.getOnlinePlayers()) {
      if (viewer.equals(sender)
          || viewer.equals(recipient)
          || !viewer.hasPermission("thestorm.essentials.socialspy")
          || !service.socialSpy(viewer.getUniqueId())) continue;
      var _ =
          runtime
              .services()
              .require(com.shepherdjerred.thestorm.core.expansion.ManagedGameplay.class)
              .enabled(
                  com.shepherdjerred.thestorm.core.expansion.ManagedGameplay.STAFF,
                  viewer.getUniqueId())
              .whenCompleteAsync(
                  (enabled, failure) -> {
                    if (failure != null) {
                      runtime.logger().error("SocialSpy rollout evaluation failed", failure);
                      return;
                    }
                    if (Boolean.TRUE.equals(enabled)
                        && viewer.isOnline()
                        && viewer.hasPermission("thestorm.essentials.socialspy")
                        && service.socialSpy(viewer.getUniqueId()))
                      viewer.sendMessage(Component.text("[SocialSpy] ").append(component));
                  },
                  runtime.scheduler().mainThread());
    }
  }

  private void requireMainThread() {
    if (!server.isPrimaryThread()) {
      throw new IllegalStateException("chat lines must be delivered on the main thread");
    }
  }
}
