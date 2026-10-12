package com.shepherdjerred.thestorm.discord.app;

import java.time.Duration;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Who a minigame lobby post may ping, from {@code discord.yml}. Every other post stays silent.
 *
 * @param roles the Discord role ids to ping; empty pings nobody
 * @param cooldownMinutes how long one game waits between pings; lobby posts inside it are silent
 */
public record LobbyPing(List<String> roles, int cooldownMinutes) {

  private static final Pattern SNOWFLAKE = Pattern.compile("[1-9][0-9]{16,19}");

  public LobbyPing {
    roles = List.copyOf(roles);
    for (var role : roles) {
      if (!SNOWFLAKE.matcher(role).matches()) {
        throw new IllegalArgumentException("roles must be Discord role ids: " + role);
      }
    }
    if (cooldownMinutes < 1) {
      throw new IllegalArgumentException("cooldownMinutes must be at least 1: " + cooldownMinutes);
    }
  }

  public Duration cooldown() {
    return Duration.ofMinutes(cooldownMinutes);
  }
}
