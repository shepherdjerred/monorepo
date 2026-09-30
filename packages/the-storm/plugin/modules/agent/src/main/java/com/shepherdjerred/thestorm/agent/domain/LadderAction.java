package com.shepherdjerred.thestorm.agent.domain;

import java.util.Locale;

/**
 * What a ladder step does. Bans are deliberately absent: ending someone's access is always a human
 * call, so ladders top out at temporary bans and escalation.
 */
public enum LadderAction {
  WARN,
  MUTE,
  KICK,
  TEMPBAN,
  ESCALATE;

  /** The lowercase id used in config, for example {@code tempban}. */
  public String id() {
    return name().toLowerCase(Locale.ROOT);
  }

  /** The action with {@code id}, as stored by {@link #id()}. */
  public static LadderAction fromId(String id) {
    for (var action : values()) {
      if (action.id().equals(id)) {
        return action;
      }
    }
    throw new IllegalArgumentException("unknown ladder action: " + id);
  }

  /** Whether this action carries a length. */
  public boolean takesDuration() {
    return switch (this) {
      case MUTE, TEMPBAN -> true;
      case WARN, KICK, ESCALATE -> false;
    };
  }
}
