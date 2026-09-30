package com.shepherdjerred.thestorm.tickets.app;

/** Something happened to a ticket. Emitted after the write succeeds. */
public sealed interface TicketEvent {

  /** The ticket, after the change. */
  TicketSnapshot ticket();

  /** A ticket was filed. */
  record Opened(TicketSnapshot ticket) implements TicketEvent {}

  /** A ticket was claimed. */
  record Claimed(TicketSnapshot ticket) implements TicketEvent {}

  /** A ticket was resolved. */
  record Resolved(TicketSnapshot ticket) implements TicketEvent {}

  /** A ticket was escalated to a human reviewer. */
  record Escalated(TicketSnapshot ticket) implements TicketEvent {}

  /** A ticket was reopened. */
  record Reopened(TicketSnapshot ticket) implements TicketEvent {}

  /** A ticket was triaged. */
  record Triaged(TicketSnapshot ticket) implements TicketEvent {}
}
