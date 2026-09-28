package com.shepherdjerred.thestorm.tickets.domain;

import java.util.Locale;

/** What a ticket is about. */
public enum TicketCategory {
  GRIEF,
  THEFT,
  CHEAT,
  CHAT,
  APPEAL,
  OTHER;

  /** The lowercase id used in storage and commands, for example {@code grief}. */
  public String id() {
    return name().toLowerCase(Locale.ROOT);
  }

  /** The category with {@code id}, as stored by {@link #id()}. */
  public static TicketCategory fromId(String id) {
    for (var category : values()) {
      if (category.id().equals(id)) {
        return category;
      }
    }
    throw new IllegalArgumentException("unknown ticket category: " + id);
  }
}
