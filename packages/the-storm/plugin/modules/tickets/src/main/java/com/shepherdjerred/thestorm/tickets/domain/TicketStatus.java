package com.shepherdjerred.thestorm.tickets.domain;

import java.util.Locale;

/**
 * Where a ticket sits in its lifecycle. Open tickets wait; claimed tickets have an owner; escalated
 * tickets wait on a human reviewer; resolved tickets are done until reopened.
 */
public enum TicketStatus {
  OPEN,
  CLAIMED,
  ESCALATED,
  RESOLVED;

  /** The lowercase id used in storage, for example {@code open}. */
  public String id() {
    return name().toLowerCase(Locale.ROOT);
  }

  /** The status with {@code id}, as stored by {@link #id()}. */
  public static TicketStatus fromId(String id) {
    for (var status : values()) {
      if (status.id().equals(id)) {
        return status;
      }
    }
    throw new IllegalArgumentException("unknown ticket status: " + id);
  }

  /** Whether a ticket may move from this status to {@code next}. */
  public boolean canTransitionTo(TicketStatus next) {
    return switch (this) {
      case OPEN -> next == CLAIMED || next == ESCALATED || next == RESOLVED;
      case CLAIMED -> next == OPEN || next == ESCALATED || next == RESOLVED;
      case ESCALATED -> next == CLAIMED || next == RESOLVED;
      case RESOLVED -> next == OPEN;
    };
  }
}
