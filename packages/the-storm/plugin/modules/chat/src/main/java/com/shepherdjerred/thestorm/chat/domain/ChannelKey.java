package com.shepherdjerred.thestorm.chat.domain;

import java.util.Arrays;
import java.util.Optional;

/** The chat channels. Their order is the order {@code /channels} lists them in. */
public enum ChannelKey {
  GLOBAL("global", "Global", "G"),
  WAR("war", "War", "W"),
  STAFF("staff", "Staff", "S"),
  TOWN("town", "Town", "T"),
  /** A match team: only the speaker's teammates hear it. */
  TEAM("team", "Team", "Tm"),
  /** The dead and spectators of a match: the living never hear it. */
  DEAD("dead", "Dead", "D");

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
      case TOWN, TEAM, DEAD -> Reach.MEMBERS;
    };
  }

  /**
   * Whether plain chat can be pointed at this channel for good. Team and dead chat belong to a
   * match, so they are reached one message at a time or through a registered router.
   */
  public boolean focusable() {
    return this != TEAM && this != DEAD;
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
    /** The speaker's group (town, match team, the dead), as a registered membership resolves it. */
    MEMBERS
  }
}
