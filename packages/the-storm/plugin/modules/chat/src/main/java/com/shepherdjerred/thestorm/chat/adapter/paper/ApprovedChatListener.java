package com.shepherdjerred.thestorm.chat.adapter.paper;

import com.shepherdjerred.thestorm.chat.app.ChatService;
import com.shepherdjerred.thestorm.chat.app.GlobalChatHub;
import com.shepherdjerred.thestorm.chat.app.OutgoingLine;
import com.shepherdjerred.thestorm.chat.domain.ChatDenial;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.core.safety.ApprovedChatEvent;
import java.util.List;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;

/**
 * Delayed publication uses server messages, preserving channel membership and actor attribution.
 */
public final class ApprovedChatListener implements Listener {
  private final ChatService chat;
  private final GlobalChatHub hub;
  private final PaperChatOutput output;

  public ApprovedChatListener(ChatService chat, GlobalChatHub hub, PaperChatOutput output) {
    this.chat = chat;
    this.hub = hub;
    this.output = output;
  }

  @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
  public void publish(ApprovedChatEvent event) {
    var player = event.player();
    var text = PlainTextComponentSerializer.plainText().serialize(event.message());
    var routed =
        chat.route(player.getUniqueId(), chat.profile(player.getUniqueId()).focus(), text, false);
    switch (chat.prepare(Speakers.of(player), routed.channel().key(), routed.text())) {
      case Result.Ok<OutgoingLine, List<ChatDenial>>(var line) -> {
        output.deliver(line);
        hub.published(line);
        chat.delivered(line);
        event.markDelivered();
        Feedback.noticeCalmed(player, line.message(), chat.capsNotice());
      }
      case Result.Err<OutgoingLine, List<ChatDenial>>(var denials) -> {
        event.setCancelled(true);
        player.sendMessage(Feedback.denials(denials));
      }
    }
  }
}
