package com.shepherdjerred.thestorm.chat.domain;

import java.util.Arrays;
import java.util.Optional;

/** The chat channels. Their order is the order {@code /channels} lists them in. */
public enum ChannelKey {
  GLOBAL("global", "Global", "G"),
  WAR("war", "War", "W"),
  STAFF("staff", "Staff", "S"),
  TOWN("town", "Town", "T");

  private final String id;
  private final String displayName;
  private final String tag;

  ChannelKey(String id, String displayName, String tag) {
    this.id = id;
    this.displayName = displayName;
    this.tag = tag;
  }

  /** The one-letter tag shown in brackets, as in {@code [G]}. */
  public String tag() {
    return tag;
  }

  /** The stable lowercase id, used in storage and config. */
  public String id() {
    return id;
  }

  /** The name shown to players. */
  public String displayName() {
    return displayName;
  }

  /** Who a message in this channel can reach. */
  public Reach reach() {
    return switch (this) {
      case GLOBAL, WAR -> Reach.EVERYONE;
      case STAFF -> Reach.STAFF;
      case TOWN -> Reach.TOWN;
    };
  }

  /** The channel with {@code id}, if there is one. */
  public static Optional<ChannelKey> fromId(String id) {
    return Arrays.stream(values()).filter(key -> key.id.equals(id)).findFirst();
  }

  /** Who a channel reaches. */
  public enum Reach {
    /** Every online player. */
    EVERYONE,
    /** Players with the staff permission. */
    STAFF,
    /** The speaker's town, as the towns module resolves it. */
    TOWN
  }
}
