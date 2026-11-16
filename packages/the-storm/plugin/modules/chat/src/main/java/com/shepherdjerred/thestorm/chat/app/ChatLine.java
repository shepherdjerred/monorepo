package com.shepherdjerred.thestorm.chat.app;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * A message sent in Global chat.
 *
 * @param at when it was sent
 * @param author who sent it
 * @param text the cleaned, plain message: no formatting codes, not escaped for any format
 * @param screened whether Safety screened this publication, so legacy enforcement must not repeat
 *     it
 * @param submissionId Safety submission identifier when tracked for asynchronous retraction
 */
public record ChatLine(
    Instant at, ChatAuthor author, String text, boolean screened, Optional<UUID> submissionId) {
  public ChatLine(Instant at, ChatAuthor author, String text, boolean screened) {
    this(at, author, text, screened, Optional.empty());
  }

  public ChatLine(Instant at, ChatAuthor author, String text) {
    this(at, author, text, false, Optional.empty());
  }
}
