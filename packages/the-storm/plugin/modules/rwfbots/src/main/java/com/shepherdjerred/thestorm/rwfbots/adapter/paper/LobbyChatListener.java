package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import io.papermc.paper.event.player.AsyncChatEvent;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;

/**
 * Hands what humans say in chat to {@link BotChat} on the main thread, so a bot in the lobby can
 * answer. Paper delivers chat off the main thread; only the speaker's id and the plain text cross
 * over, and {@link BotChat#heard} decides on the main thread whether the speaker waits in the
 * lobby. A message another plugin cancelled is never answered.
 */
final class LobbyChatListener implements Listener {

  private final BotChat chat;
  private final Scheduler scheduler;

  LobbyChatListener(BotChat chat, Scheduler scheduler) {
    this.chat = chat;
    this.scheduler = scheduler;
  }

  @EventHandler(ignoreCancelled = true, priority = EventPriority.MONITOR)
  void onChat(AsyncChatEvent event) {
    var human = event.getPlayer().getUniqueId();
    var text = PlainTextComponentSerializer.plainText().serialize(event.originalMessage());
    scheduler.runOnMainThread(() -> chat.heard(human, text));
  }
}
