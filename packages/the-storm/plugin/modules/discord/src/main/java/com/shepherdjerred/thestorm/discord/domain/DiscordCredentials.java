package com.shepherdjerred.thestorm.discord.domain;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.function.Function;

/**
 * The bot token and bridged channel, read from the environment. The token never appears in {@link
 * #toString()} or in any error message.
 *
 * @param token the bot token
 * @param channelId the Discord channel to bridge
 */
public record DiscordCredentials(String token, long channelId) {

  public DiscordCredentials {
    if (token.isBlank()) {
      throw new IllegalArgumentException("the bot token must not be blank");
    }
    if (channelId <= 0) {
      throw new IllegalArgumentException("the channel id must be positive");
    }
  }

  /**
   * Reads the credentials from the environment variables named {@code tokenVariable} and {@code
   * channelVariable}, or lists every variable that is missing or malformed.
   */
  public static Result<DiscordCredentials, List<String>> resolve(
      String tokenVariable,
      String channelVariable,
      Function<String, Optional<String>> environment) {
    var problems = new ArrayList<String>();
    var token = environment.apply(tokenVariable).map(String::strip).filter(v -> !v.isEmpty());
    if (token.isEmpty()) {
      problems.add("environment variable " + tokenVariable + " (the bot token) is not set");
    }
    var channel = environment.apply(channelVariable).map(String::strip).filter(v -> !v.isEmpty());
    Optional<Long> channelId = Optional.empty();
    if (channel.isEmpty()) {
      problems.add("environment variable " + channelVariable + " (the channel id) is not set");
    } else {
      channelId = parseSnowflake(channel.get());
      if (channelId.isEmpty()) {
        problems.add("environment variable " + channelVariable + " is not a Discord channel id");
      }
    }
    if (!problems.isEmpty() || token.isEmpty() || channelId.isEmpty()) {
      return Result.err(List.copyOf(problems));
    }
    return Result.ok(new DiscordCredentials(token.get(), channelId.get()));
  }

  private static Optional<Long> parseSnowflake(String value) {
    if (!value.chars().allMatch(c -> c >= '0' && c <= '9')) {
      return Optional.empty();
    }
    try {
      var id = Long.parseLong(value);
      return id > 0 ? Optional.of(id) : Optional.empty();
    } catch (NumberFormatException tooLarge) {
      return Optional.empty();
    }
  }

  @Override
  public String toString() {
    return "DiscordCredentials[token=<redacted>, channelId=" + channelId + "]";
  }
}
