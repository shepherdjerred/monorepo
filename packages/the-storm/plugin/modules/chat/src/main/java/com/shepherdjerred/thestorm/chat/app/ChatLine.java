package com.shepherdjerred.thestorm.chat.app;

import java.time.Instant;

/**
 * A message sent in Global chat.
 *
 * @param at when it was sent
 * @param author who sent it
 * @param text the cleaned, plain message: no formatting codes, not escaped for any format
 * @param screened whether Safety screened this publication, so legacy enforcement must not repeat
 *     it
 */
public record ChatLine(Instant at, ChatAuthor author, String text, boolean screened) {
  public ChatLine(Instant at, ChatAuthor author, String text) {
    this(at, author, text, false);
  }
}
