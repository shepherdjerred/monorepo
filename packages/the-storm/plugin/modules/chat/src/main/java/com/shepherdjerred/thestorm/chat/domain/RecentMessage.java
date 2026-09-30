package com.shepherdjerred.thestorm.chat.domain;

import java.time.Instant;
import java.util.Locale;

/**
 * The last message a player sent, for the repeat limit.
 *
 * @param normalized the message, lowercased, as compared for repeats
 * @param at when it was sent
 */
public record RecentMessage(String normalized, Instant at) {

  /** Remembers {@code text}, sent at {@code at}. */
  public static RecentMessage of(String text, Instant at) {
    return new RecentMessage(normalize(text), at);
  }

  static String normalize(String text) {
    return ChatText.clean(text).toLowerCase(Locale.ROOT);
  }
}
