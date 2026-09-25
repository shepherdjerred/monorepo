package com.shepherdjerred.thestorm.discord.app;

/** Posts to the bridged Discord channel. Thread-safe and non-blocking. */
public interface DiscordGateway {

  /**
   * Posts {@code text} (Discord markdown, already escaped) to the channel with every mention
   * disabled. Dropped with a log line while the bot is not connected.
   */
  void post(String text);
}
