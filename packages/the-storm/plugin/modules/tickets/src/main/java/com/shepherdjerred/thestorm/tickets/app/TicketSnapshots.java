package com.shepherdjerred.thestorm.tickets.app;

import com.shepherdjerred.thestorm.tickets.domain.Ticket;
import com.shepherdjerred.thestorm.tickets.domain.TicketComment;
import com.shepherdjerred.thestorm.tickets.domain.TicketLocation;
import com.shepherdjerred.thestorm.tickets.domain.Triage;

/** Maps ticket domain types to the snapshots other modules consume. */
public final class TicketSnapshots {

  private TicketSnapshots() {}

  /** The snapshot of {@code ticket}. */
  public static TicketSnapshot from(Ticket ticket) {
    return new TicketSnapshot(
        ticket.id(),
        ticket.reporter(),
        ticket.category().id(),
        ticket.status().id(),
        ticket.priority().id(),
        ticket.summary(),
        ticket.location().map(TicketSnapshots::from),
        ticket.createdAt(),
        ticket.updatedAt(),
        ticket.claimer(),
        ticket.triage().map(TicketSnapshots::from),
        ticket.server());
  }

  /** The snapshot of {@code comment}. */
  public static CommentSnapshot from(TicketComment comment) {
    return new CommentSnapshot(
        comment.id(), comment.author(), comment.staffOnly(), comment.body(), comment.at());
  }

  /** The snapshot of {@code triage}. */
  public static TriageSnapshot from(Triage triage) {
    return new TriageSnapshot(
        triage.priority().id(),
        triage.duplicateIds(),
        triage.evidence(),
        triage.draftReply(),
        triage.at());
  }

  /** The snapshot of {@code location}. */
  public static LocationSnapshot from(TicketLocation location) {
    return new LocationSnapshot(location.world(), location.x(), location.y(), location.z());
  }
}
