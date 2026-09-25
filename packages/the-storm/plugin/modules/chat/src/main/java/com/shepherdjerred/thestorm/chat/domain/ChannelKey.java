package com.shepherdjerred.thestorm.chat.domain;

import java.util.Arrays;
import java.util.Optional;

/** The chat channels. Their order is the order {@code /channels} lists them in. */
public enum ChannelKey {
  GLOBAL("global", "Global"),
  WAR("war", "War"),
  STAFF("staff", "Staff"),
  TOWN("town", "Town"),
  NATION("nation", "Nation");

  private final String id;
  private final String displayName;

  ChannelKey(String id, String displayName) {
    this.id = id;
    this.displayName = displayName;
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
      case TOWN, NATION -> Reach.GROUP;
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
    /** The speaker's town or nation, as another module resolves it. */
    GROUP
  }
}
