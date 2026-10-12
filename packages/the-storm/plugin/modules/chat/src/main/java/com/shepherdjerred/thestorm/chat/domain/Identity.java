package com.shepherdjerred.thestorm.chat.domain;

import java.util.Locale;
import java.util.Optional;
import java.util.Set;

/** Plain identity and private-message preferences; rank formatting is never player input. */
public record Identity(
    Optional<String> nickname, boolean messages, boolean replies, boolean socialSpy) {
  private static final Set<String> RESERVED =
      Set.of("admin", "administrator", "moderator", "staff", "owner", "console", "thestorm");

  public Identity {
    nickname.ifPresent(
        name -> {
          if (!name.matches("[A-Za-z0-9_]{3,16}")
              || RESERVED.contains(name.toLowerCase(Locale.ROOT)))
            throw new IllegalArgumentException(
                "Use 3–16 letters, digits or underscores; staff titles are reserved.");
        });
  }

  public static Identity fresh() {
    return new Identity(Optional.empty(), true, true, false);
  }

  public Identity named(Optional<String> name) {
    return new Identity(name, messages, replies, socialSpy);
  }

  public Identity toggleMessages() {
    return new Identity(nickname, !messages, replies, socialSpy);
  }

  public Identity toggleReplies() {
    return new Identity(nickname, messages, !replies, socialSpy);
  }

  public Identity toggleSpy() {
    return new Identity(nickname, messages, replies, !socialSpy);
  }
}
