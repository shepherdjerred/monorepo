package com.shepherdjerred.thestorm.chat.domain;

import java.time.Duration;

/**
 * The 2017 chat rules, from {@code chat.yml}.
 *
 * @param maxLength the longest message, in characters, after cleaning
 * @param maxCapsWords how many all-capital words a message may have
 * @param repeatCooldownSeconds how long before the same message may be sent again
 */
public record FilterSettings(int maxLength, int maxCapsWords, long repeatCooldownSeconds) {

  /** Minecraft's own limit on a chat message. */
  public static final int CLIENT_LIMIT = 256;

  public FilterSettings {
    if (maxLength < 1 || maxLength > CLIENT_LIMIT) {
      throw new IllegalArgumentException("maxLength must be 1.." + CLIENT_LIMIT);
    }
    if (maxCapsWords < 0) {
      throw new IllegalArgumentException("maxCapsWords must not be negative");
    }
    if (repeatCooldownSeconds < 0) {
      throw new IllegalArgumentException("repeatCooldownSeconds must not be negative");
    }
  }

  public Duration repeatCooldown() {
    return Duration.ofSeconds(repeatCooldownSeconds);
  }
}
