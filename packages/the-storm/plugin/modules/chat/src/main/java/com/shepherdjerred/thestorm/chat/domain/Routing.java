package com.shepherdjerred.thestorm.chat.domain;

import java.util.Set;
import java.util.UUID;

/** Who receives a message. */
public final class Routing {

  private Routing() {}

  /**
   * Whether {@code viewer} receives a message {@code speaker} sent in {@code channel}.
   *
   * <p>The speaker always sees their own message. Otherwise a viewer must not have hidden the
   * channel, must not ignore the speaker (except in staff chat, which staff cannot ignore away),
   * and must be in the channel's reach: everyone, staff, or the speaker's town.
   *
   * @param groupMembers the speaker's town for town chat; ignored otherwise
   */
  public static boolean receives(
      ChannelKey channel, UUID speaker, Viewer viewer, Set<UUID> groupMembers) {
    if (viewer.id().equals(speaker)) {
      return true;
    }
    if (!viewer.profile().receives(channel)) {
      return false;
    }
    if (channel != ChannelKey.STAFF && viewer.profile().ignores(speaker)) {
      return false;
    }
    return switch (channel.reach()) {
      case EVERYONE -> true;
      case STAFF -> viewer.staff();
      case TOWN -> groupMembers.contains(viewer.id());
    };
  }

  /** Whether {@code viewer} receives a relayed message (from Discord) in Global. */
  public static boolean receivesExternal(Viewer viewer) {
    return viewer.profile().receives(ChannelKey.GLOBAL);
  }

  /**
   * A player who might receive a message.
   *
   * @param id the player
   * @param staff whether they hold the staff permission
   * @param profile their chat preferences
   */
  public record Viewer(UUID id, boolean staff, ChatProfile profile) {}
}
