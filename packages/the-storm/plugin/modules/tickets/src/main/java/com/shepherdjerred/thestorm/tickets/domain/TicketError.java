package com.shepherdjerred.thestorm.tickets.domain;

/** Why a ticket operation failed in an expected way. */
public enum TicketError {
  /** No ticket has the id. */
  TICKET_NOT_FOUND,
  /** The status change is not allowed from here. */
  ILLEGAL_TRANSITION,
}
