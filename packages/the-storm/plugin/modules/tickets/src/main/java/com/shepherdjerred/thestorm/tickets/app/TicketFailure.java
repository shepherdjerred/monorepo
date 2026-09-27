package com.shepherdjerred.thestorm.tickets.app;

/**
 * Why an agent-facing ticket write failed. Domain errors stay inside the module; the agent only
 * needs to know whether the ticket was missing or its input was unusable.
 */
public enum TicketFailure {
  /** No ticket with the id. */
  TICKET_NOT_FOUND,
  /** The input was unusable: unknown ids, illegal transitions, or bad text. */
  INVALID_INPUT;
}
