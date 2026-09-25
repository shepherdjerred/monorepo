package com.shepherdjerred.thestorm.chat.domain;

import java.time.Duration;

/** Why a message was not sent. */
public sealed interface ChatDenial {

  /** Nothing is left once the message is cleaned. */
  record Blank() implements ChatDenial {}

  /** The message is longer than {@code max} characters. */
  record TooLong(int max) implements ChatDenial {}

  /** More than {@code max} words are in capitals. */
  record TooManyCaps(int max) implements ChatDenial {}

  /** The same message was sent too recently; it may be sent again after {@code retryAfter}. */
  record Repeated(Duration retryAfter) implements ChatDenial {}

  /** The speaker is muted for {@code remaining} more. */
  record Muted(Duration remaining, String reason) implements ChatDenial {}

  /** The speaker may not use {@code channel}; {@code access} says why. */
  record NoAccess(ChannelKey channel, ChannelAccess access) implements ChatDenial {

    public NoAccess {
      if (access == ChannelAccess.GRANTED) {
        throw new IllegalArgumentException("granted access is not a denial");
      }
    }
  }
}
