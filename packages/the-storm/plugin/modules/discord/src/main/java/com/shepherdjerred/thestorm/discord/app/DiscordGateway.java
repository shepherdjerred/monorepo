package com.shepherdjerred.thestorm.discord.app;

import java.util.List;

/** Posts to the bridged Discord channel. Thread-safe and non-blocking. */
public interface DiscordGateway {

  /**
   * Posts {@code text} (Discord markdown, already escaped) to the channel with every mention
   * disabled. Dropped with a log line while the bot is not connected.
   */
  void post(String text);

  /**
   * Posts {@code text} like {@link #post}, but lets it notify the listed roles and nobody else.
   *
   * @param roles Discord role ids the text mentions
   */
  void ping(String text, List<String> roles);
}
