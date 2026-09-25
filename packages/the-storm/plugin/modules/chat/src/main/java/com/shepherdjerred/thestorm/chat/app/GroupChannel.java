package com.shepherdjerred.thestorm.chat.app;

import com.shepherdjerred.thestorm.chat.domain.ChannelKey;

/** The channels whose members another module decides. */
public enum GroupChannel {
  /** Town chat ({@code /tc}). */
  TOWN,
  /** Nation chat ({@code /nc}). */
  NATION;

  /** The group channel behind {@code key}, which must reach a group. */
  static GroupChannel of(ChannelKey key) {
    return switch (key) {
      case TOWN -> TOWN;
      case NATION -> NATION;
      case GLOBAL, WAR, STAFF -> throw new IllegalArgumentException(key + " is not a group");
    };
  }
}
