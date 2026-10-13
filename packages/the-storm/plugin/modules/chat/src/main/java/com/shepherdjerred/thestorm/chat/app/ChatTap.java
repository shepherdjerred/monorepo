package com.shepherdjerred.thestorm.chat.app;

import java.time.Instant;
import java.util.UUID;

/**
 * Hears every channel line chat delivered, players' and NPCs' alike (not emotes, private messages
 * or relayed lines). Registered through {@link ChannelRegistry}.
 *
 * <p>Called on the thread the line was delivered on, which for plain chat is Paper's async chat
 * thread, so implementations must be thread-safe and must not block or touch world state.
 */
@FunctionalInterface
public interface ChatTap {

  void heard(Heard line);

  /**
   * One delivered line.
   *
   * @param speaker who said it
   * @param npc whether an NPC (such as a bot) said it through {@link NpcChat}
   * @param channel where it went
   * @param text the cleaned text as delivered
   * @param at when it was accepted
   */
  record Heard(UUID speaker, boolean npc, ChatChannel channel, String text, Instant at) {}
}
