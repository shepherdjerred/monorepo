package com.shepherdjerred.thestorm.discord.app;

import com.shepherdjerred.thestorm.discord.domain.DiscordText;
import java.util.regex.Pattern;

/**
 * {@code plugins/TheStorm/discord.yml}. Secrets are never in this file: it names the environment
 * variables that hold them.
 *
 * @param tokenEnv the environment variable holding the bot token
 * @param channelEnv the environment variable holding the bridged channel's id
 * @param status the bot's custom status
 * @param source the label Discord messages carry in game, such as {@code D}
 * @param maxInboundLength the longest Discord message relayed into the game, in characters
 * @param messages what the bot posts
 */
public record DiscordConfig(
    String tokenEnv,
    String channelEnv,
    String status,
    String source,
    int maxInboundLength,
    DiscordMessages messages) {

  /** Discord's limit on a custom status. */
  public static final int MAX_STATUS_LENGTH = 128;

  /** Minecraft's limit on a chat message. */
  public static final int MAX_GAME_MESSAGE = 256;

  private static final Pattern VARIABLE = Pattern.compile("[A-Z][A-Z0-9_]*");

  public DiscordConfig {
    requireVariable("tokenEnv", tokenEnv);
    requireVariable("channelEnv", channelEnv);
    if (status.isBlank() || status.length() > MAX_STATUS_LENGTH) {
      throw new IllegalArgumentException("status must be 1.." + MAX_STATUS_LENGTH + " characters");
    }
    if (DiscordText.clean(source).isEmpty() || source.length() > 8) {
      throw new IllegalArgumentException("source must be a short label");
    }
    if (maxInboundLength < 1 || maxInboundLength > MAX_GAME_MESSAGE) {
      throw new IllegalArgumentException("maxInboundLength must be 1.." + MAX_GAME_MESSAGE);
    }
  }

  private static void requireVariable(String key, String value) {
    if (!VARIABLE.matcher(value).matches()) {
      throw new IllegalArgumentException(key + " must name an environment variable: " + value);
    }
  }
}
