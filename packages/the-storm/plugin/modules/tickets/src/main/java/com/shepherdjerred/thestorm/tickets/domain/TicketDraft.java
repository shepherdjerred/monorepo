package com.shepherdjerred.thestorm.tickets.domain;

import java.util.Optional;
import java.util.UUID;

/**
 * A ticket being filed, before it has an id.
 *
 * @param reporter who files it
 * @param category what it is about
 * @param summary what happened, in the reporter's words
 * @param location where it happened, when captured
 */
public record TicketDraft(
    UUID reporter, TicketCategory category, String summary, Optional<TicketLocation> location) {
  public TicketDraft {
    if (summary.isBlank() || summary.length() > Ticket.MAX_SUMMARY_LENGTH) {
      throw new IllegalArgumentException(
          "summary must be 1-" + Ticket.MAX_SUMMARY_LENGTH + " characters");
    }
  }
}
