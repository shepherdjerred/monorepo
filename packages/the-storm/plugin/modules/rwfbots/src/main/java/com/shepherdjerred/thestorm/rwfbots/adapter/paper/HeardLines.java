package com.shepherdjerred.thestorm.rwfbots.adapter.paper;

import com.shepherdjerred.thestorm.chat.app.ChatChannel;
import com.shepherdjerred.thestorm.chat.app.ChatTap;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;

/**
 * Hands what humans say in Global and Team chat to {@link BotChat} on the main thread, so a bot in
 * the lobby can answer. Chat taps every delivered line, on Paper's async chat thread for plain
 * chat; only the speaker's id and the cleaned text cross over, and {@link BotChat#heard} decides on
 * the main thread whether the speaker waits in the lobby. NPC lines (the bots themselves) and every
 * other channel are ignored, and a line chat refused is never tapped.
 */
final class HeardLines implements ChatTap {

  private final BotChat chat;
  private final Scheduler scheduler;

  HeardLines(BotChat chat, Scheduler scheduler) {
    this.chat = chat;
    this.scheduler = scheduler;
  }

  @Override
  public void heard(Heard line) {
    if (line.npc()
        || (line.channel() != ChatChannel.GLOBAL && line.channel() != ChatChannel.TEAM)) {
      return;
    }
    scheduler.runOnMainThread(() -> chat.heard(line.speaker(), line.text()));
  }
}
