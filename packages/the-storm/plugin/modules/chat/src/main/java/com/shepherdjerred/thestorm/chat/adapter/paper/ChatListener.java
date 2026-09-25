package com.shepherdjerred.thestorm.chat.adapter.paper;

import com.shepherdjerred.thestorm.chat.app.ChatService;
import com.shepherdjerred.thestorm.chat.app.GlobalChatHub;
import com.shepherdjerred.thestorm.chat.app.OutgoingLine;
import com.shepherdjerred.thestorm.chat.domain.ChatDenial;
import com.shepherdjerred.thestorm.core.result.Result;
import io.papermc.paper.event.player.AsyncChatEvent;
import java.util.List;
import net.kyori.adventure.text.minimessage.MiniMessage;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;

/**
 * Routes plain chat to the player's focused channel. Runs on Paper's async chat thread: it only
 * reads chat's in-memory state and permissions.
 */
public final class ChatListener implements Listener {

  private final ChatService service;
  private final GlobalChatHub hub;

  public ChatListener(ChatService service, GlobalChatHub hub) {
    this.service = service;
    this.hub = hub;
  }

  /** Checks the message, narrows the viewers to the channel and installs its renderer. */
  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  public void onChat(AsyncChatEvent event) {
    var player = event.getPlayer();
    var raw = PlainTextComponentSerializer.plainText().serialize(event.message());
    var channel = service.profile(player.getUniqueId()).focus();
    switch (service.prepare(Speakers.of(player), channel, raw)) {
      case Result.Ok<OutgoingLine, List<ChatDenial>>(var line) -> {
        event
            .viewers()
            .removeIf(
                viewer ->
                    viewer instanceof Player other
                        && !service.receives(line, other.getUniqueId(), Speakers.isStaff(other)));
        event.renderer(
            new ChannelRenderer(line, MiniMessage.miniMessage().deserialize(service.render(line))));
        Feedback.noticeCalmed(player, line.message(), service.capsNotice());
      }
      case Result.Err<OutgoingLine, List<ChatDenial>>(var denials) -> {
        event.setCancelled(true);
        player.sendMessage(Feedback.denials(denials));
      }
    }
  }

  /** Publishes the line to Global listeners (Discord) once no one has cancelled it. */
  @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
  public void onDelivered(AsyncChatEvent event) {
    if (event.renderer() instanceof ChannelRenderer renderer) {
      hub.published(renderer.line());
    }
  }
}
