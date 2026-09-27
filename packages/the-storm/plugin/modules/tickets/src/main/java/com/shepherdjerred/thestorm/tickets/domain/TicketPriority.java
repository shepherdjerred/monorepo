package com.shepherdjerred.thestorm.tickets.domain;

import java.util.Locale;

/** How urgently a ticket needs attention. */
public enum TicketPriority {
  LOW(0),
  NORMAL(1),
  URGENT(2);

  private final int rank;

  TicketPriority(int rank) {
    this.rank = rank;
  }

  /** The lowercase id used in storage, for example {@code urgent}. */
  public String id() {
    return name().toLowerCase(Locale.ROOT);
  }

  /** The priority with {@code id}, as stored by {@link #id()}. */
  public static TicketPriority fromId(String id) {
    for (var priority : values()) {
      if (priority.id().equals(id)) {
        return priority;
      }
    }
    throw new IllegalArgumentException("unknown ticket priority: " + id);
  }

  /** Whether this priority is at least {@code other}. */
  public boolean atLeast(TicketPriority other) {
    return rank >= other.rank;
  }
}
