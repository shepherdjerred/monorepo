package com.shepherdjerred.thestorm.agent.domain;

import java.util.Locale;

/** What the agent did about a case. Bans are absent: they are always human calls. */
public enum DecisionAction {
  ALLOW,
  WARN,
  MUTE,
  KICK,
  TEMPBAN,
  ESCALATE;

  /** The lowercase id used in storage, for example {@code tempban}. */
  public String id() {
    return name().toLowerCase(Locale.ROOT);
  }

  /** The action with {@code id}, as stored by {@link #id()}. */
  public static DecisionAction fromId(String id) {
    for (var action : values()) {
      if (action.id().equals(id)) {
        return action;
      }
    }
    throw new IllegalArgumentException("unknown decision action: " + id);
  }

  /** Whether this action counts as a strike toward the next ladder rung. */
  public boolean isStrike() {
    return switch (this) {
      case WARN, MUTE, KICK, TEMPBAN -> true;
      case ALLOW, ESCALATE -> false;
    };
  }
}
