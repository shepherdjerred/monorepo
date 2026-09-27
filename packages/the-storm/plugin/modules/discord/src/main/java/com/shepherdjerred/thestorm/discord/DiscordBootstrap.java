package com.shepherdjerred.thestorm.discord;

import java.util.Map;

/** Credentials and the externally assigned channel address supplied by the pod bootstrap. */
public record DiscordBootstrap(String token, long channelId) {

  public static final String TOKEN_ENV = "THE_STORM_DISCORD_BOT_TOKEN";
  public static final String CHANNEL_ENV = "THE_STORM_DISCORD_CHANNEL_ID";

  public DiscordBootstrap {
    if (token.isBlank()) {
      throw new IllegalArgumentException("Discord bot token is empty");
    }
    if (channelId <= 0) {
      throw new IllegalArgumentException("Discord channel ID must be positive");
    }
  }

  /** Never includes the credential value in an error or log message. */
  public static DiscordBootstrap fromEnvironment(Map<String, String> environment) {
    var token = environment.get(TOKEN_ENV);
    if (token == null || token.isBlank()) {
      throw new IllegalStateException("Missing " + TOKEN_ENV);
    }
    var channel = environment.get(CHANNEL_ENV);
    if (channel == null || !channel.matches("[0-9]{17,20}")) {
      throw new IllegalStateException("Missing or invalid " + CHANNEL_ENV);
    }
    try {
      return new DiscordBootstrap(token, Long.parseLong(channel));
    } catch (NumberFormatException e) {
      throw new IllegalStateException("Invalid " + CHANNEL_ENV, e);
    }
  }
}
