package com.shepherdjerred.thestorm.chat.app;

import java.util.Optional;
import java.util.UUID;

/**
 * Redirects a player's line before chat checks and delivers it: a leading {@code @} to their team,
 * say, or a dead player's Global line to the dead. Registered through {@link ChannelRegistry}; the
 * first router that answers wins and the rest are not asked.
 *
 * <p>Called from Paper's async chat threads as well as the main thread, so implementations must be
 * thread-safe and must not block or touch world state.
 */
@FunctionalInterface
public interface ChannelRouter {

  /** Where the line goes instead and what it says there, or empty to leave it alone. */
  Optional<Routed> route(Request request);

  /**
   * A line about to be sent.
   *
   * @param speaker who
   * @param chosen the channel it is headed for: the player's focus for plain chat, or the channel
   *     of a one-shot command such as {@code /g <message>}
   * @param text what they typed, before any rule ran
   * @param command whether a one-shot command named the channel; plain chat when false
   */
  record Request(UUID speaker, ChatChannel chosen, String text, boolean command) {}

  /**
   * Where a routed line goes.
   *
   * @param channel the channel instead
   * @param text the text to send, with any routing prefix (such as {@code @}) removed
   */
  record Routed(ChatChannel channel, String text) {}
}
