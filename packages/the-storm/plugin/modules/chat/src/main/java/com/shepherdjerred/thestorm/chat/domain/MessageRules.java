package com.shepherdjerred.thestorm.chat.domain;

import java.time.Duration;
import java.util.Optional;

/**
 * The chat rules that can refuse a message. Each is small and independent; {@link MessageValidator}
 * composes them. Where a message may go is decided before the rules run.
 */
public final class MessageRules {

  private MessageRules() {}

  /** A muted speaker cannot talk anywhere until the mute ends. Staff are not exempt. */
  public record MuteRule() implements MessageRule {
    @Override
    public Optional<ChatDenial> check(ChatAttempt attempt, ChatFacts facts) {
      var mute = facts.mute();
      if (mute == null || !mute.activeAt(attempt.at())) {
        return Optional.empty();
      }
      return Optional.of(new ChatDenial.Muted(mute.remainingAt(attempt.at()), mute.reason()));
    }
  }

  /** The message must say something. */
  public record BlankRule() implements MessageRule {
    @Override
    public Optional<ChatDenial> check(ChatAttempt attempt, ChatFacts facts) {
      return attempt.text().isEmpty() ? Optional.of(new ChatDenial.Blank()) : Optional.empty();
    }
  }

  /** The message must fit in {@code max} characters (code points). */
  public record LengthRule(int max) implements MessageRule {
    @Override
    public Optional<ChatDenial> check(ChatAttempt attempt, ChatFacts facts) {
      var text = attempt.text();
      return text.codePointCount(0, text.length()) > max
          ? Optional.of(new ChatDenial.TooLong(max))
          : Optional.empty();
    }
  }

  /** The same message (ignoring case) may not be sent again within {@code cooldown}. */
  public record RepeatRule(Duration cooldown) implements MessageRule {
    @Override
    public Optional<ChatDenial> check(ChatAttempt attempt, ChatFacts facts) {
      var last = facts.last();
      if (attempt.speaker().bypassFilters()
          || last == null
          || !last.normalized().equals(RecentMessage.normalize(attempt.text()))) {
        return Optional.empty();
      }
      var allowedAt = last.at().plus(cooldown);
      return attempt.at().isBefore(allowedAt)
          ? Optional.of(new ChatDenial.Repeated(Duration.between(attempt.at(), allowedAt)))
          : Optional.empty();
    }
  }
}
