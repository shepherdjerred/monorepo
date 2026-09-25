package com.shepherdjerred.thestorm.essentials.domain.moderation;

import java.util.Locale;

/**
 * What a moderator did. Mutes belong to the chat module, which owns {@code /mute} and every chat
 * channel.
 */
public enum ModerationAction {
  KICK,
  BAN,
  UNBAN;

  /** The lowercase id used in storage, for example {@code ban}. */
  public String id() {
    return name().toLowerCase(Locale.ROOT);
  }

  /** The action with {@code id}, as stored by {@link #id()}. */
  public static ModerationAction fromId(String id) {
    for (var action : values()) {
      if (action.id().equals(id)) {
        return action;
      }
    }
    throw new IllegalArgumentException("unknown moderation action: " + id);
  }

  /** Whether this action can carry an expiry (a temporary ban). */
  public boolean canExpire() {
    return switch (this) {
      case BAN -> true;
      case KICK, UNBAN -> false;
    };
  }
}
