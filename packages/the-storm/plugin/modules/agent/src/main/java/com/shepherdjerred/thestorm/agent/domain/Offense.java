package com.shepherdjerred.thestorm.agent.domain;

import java.util.Locale;

/** What a player did wrong, as the ladders see it. */
public enum Offense {
  SPAM,
  ADVERTISING,
  SLUR,
  TOXICITY,
  GRIEF,
  THEFT,
  CHEAT,
  HARASSMENT,
  /**
   * Case bookkeeping with no accusation, such as triage runs. Never laddered: the judge allows it,
   * and enforcement records never carry it.
   */
  OTHER;

  /** The lowercase id used in config and storage, for example {@code grief}. */
  public String id() {
    return name().toLowerCase(Locale.ROOT);
  }

  /** The offense with {@code id}, as stored by {@link #id()}. */
  public static Offense fromId(String id) {
    for (var offense : values()) {
      if (offense.id().equals(id)) {
        return offense;
      }
    }
    throw new IllegalArgumentException("unknown offense: " + id);
  }
}
