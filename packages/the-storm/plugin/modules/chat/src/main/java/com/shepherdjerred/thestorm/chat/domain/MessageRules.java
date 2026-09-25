package com.shepherdjerred.thestorm.chat.domain;

import java.time.Duration;
import java.util.Arrays;
import java.util.Optional;

/** The chat rules. Each is small and independent; {@link MessageValidator} composes them. */
public final class MessageRules {

  private MessageRules() {}

  /** The speaker must be allowed in the channel. */
  public record ChannelAccessRule() implements MessageRule {
    @Override
    public Optional<ChatDenial> check(ChatAttempt attempt, ChatFacts facts) {
      return facts.access() == ChannelAccess.GRANTED
          ? Optional.empty()
          : Optional.of(new ChatDenial.NoAccess(attempt.channel(), facts.access()));
    }
  }

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

  /**
   * At most {@code max} words may be in capitals. A word counts when it has at least two letters
   * and none of them are lowercase, so "I" does not count and "OK?" does.
   */
  public record CapsRule(int max) implements MessageRule {
    @Override
    public Optional<ChatDenial> check(ChatAttempt attempt, ChatFacts facts) {
      if (attempt.speaker().bypassFilters()) {
        return Optional.empty();
      }
      var shouting = Arrays.stream(attempt.text().split(" ")).filter(CapsRule::isCaps).count();
      return shouting > max ? Optional.of(new ChatDenial.TooManyCaps(max)) : Optional.empty();
    }

    static boolean isCaps(String word) {
      var letters = 0;
      for (var i = 0; i < word.length(); i++) {
        var c = word.charAt(i);
        if (Character.isLowerCase(c)) {
          return false;
        }
        if (Character.isLetter(c)) {
          letters++;
        }
      }
      return letters >= 2;
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
