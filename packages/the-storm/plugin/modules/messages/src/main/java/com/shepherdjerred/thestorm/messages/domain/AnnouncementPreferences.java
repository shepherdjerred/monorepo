package com.shepherdjerred.thestorm.messages.domain;

import java.util.EnumSet;
import java.util.Set;

/**
 * Which announcement channels a player has muted. Everyone hears every channel until they mute it.
 *
 * @param muted the muted channels
 */
public record AnnouncementPreferences(Set<Channel> muted) {

  public AnnouncementPreferences {
    muted = Set.copyOf(muted);
  }

  /** A player who has muted nothing. */
  public static AnnouncementPreferences hearingEverything() {
    return new AnnouncementPreferences(Set.of());
  }

  /** Whether announcements on {@code channel} reach this player. */
  public boolean hears(Channel channel) {
    return !muted.contains(channel);
  }

  /** The preferences with {@code channel} flipped between heard and muted. */
  public AnnouncementPreferences toggle(Channel channel) {
    var next = muted.isEmpty() ? EnumSet.noneOf(Channel.class) : EnumSet.copyOf(muted);
    if (!next.remove(channel)) {
      next.add(channel);
    }
    return new AnnouncementPreferences(next);
  }
}
