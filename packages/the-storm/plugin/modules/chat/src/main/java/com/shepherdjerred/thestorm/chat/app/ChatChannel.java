package com.shepherdjerred.thestorm.chat.app;

import com.shepherdjerred.thestorm.chat.domain.ChannelKey;

/**
 * The chat channels as other modules name them. Modules reach chat through its app package only, so
 * this mirrors {@link ChannelKey} one for one.
 */
public enum ChatChannel {
  GLOBAL(ChannelKey.GLOBAL),
  WAR(ChannelKey.WAR),
  STAFF(ChannelKey.STAFF),
  TOWN(ChannelKey.TOWN),
  /** A match team: only the speaker's teammates hear it. */
  TEAM(ChannelKey.TEAM),
  /** A match's dead and spectators: the living never hear it. */
  DEAD(ChannelKey.DEAD);

  private final ChannelKey key;

  ChatChannel(ChannelKey key) {
    this.key = key;
  }

  /** The channel inside chat. */
  public ChannelKey key() {
    return key;
  }

  /** The channel {@code key} is. */
  public static ChatChannel of(ChannelKey key) {
    return switch (key) {
      case GLOBAL -> GLOBAL;
      case WAR -> WAR;
      case STAFF -> STAFF;
      case TOWN -> TOWN;
      case TEAM -> TEAM;
      case DEAD -> DEAD;
    };
  }
}
