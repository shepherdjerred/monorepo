package com.shepherdjerred.thestorm.tickets.domain;

import java.time.Instant;
import java.util.UUID;

/**
 * One follow-up on a ticket, from the reporter, staff, or the AI agent.
 *
 * @param id the comment id
 * @param author who wrote it
 * @param staffOnly whether only staff may see it
 * @param body what was said
 * @param at when
 */
public record TicketComment(long id, UUID author, boolean staffOnly, String body, Instant at) {

  /** The longest body kept. */
  public static final int MAX_BODY_LENGTH = 1000;

  public TicketComment {
    if (body.isBlank() || body.length() > MAX_BODY_LENGTH) {
      throw new IllegalArgumentException("body must be 1-" + MAX_BODY_LENGTH + " characters");
    }
  }
}
