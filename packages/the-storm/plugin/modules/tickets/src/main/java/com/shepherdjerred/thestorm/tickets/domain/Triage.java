package com.shepherdjerred.thestorm.tickets.domain;

import java.time.Instant;
import java.util.List;

/**
 * The AI agent's working of a ticket: what it is, how urgent it is, what duplicates it, what the
 * evidence shows, and what to tell the reporter. A ticket holds at most one; a re-triage replaces
 * it.
 *
 * @param priority the suggested priority
 * @param duplicateIds likely-duplicate ticket ids, least-recent first
 * @param evidence the evidence-pack summary
 * @param draftReply the proposed reply to the reporter
 * @param at when the triage ran
 */
public record Triage(
    TicketPriority priority,
    List<Long> duplicateIds,
    String evidence,
    String draftReply,
    Instant at) {

  /** The longest evidence or draft kept. */
  public static final int MAX_TEXT_LENGTH = 2000;

  public Triage {
    if (evidence.isBlank() || evidence.length() > MAX_TEXT_LENGTH) {
      throw new IllegalArgumentException("evidence must be 1-" + MAX_TEXT_LENGTH + " characters");
    }
    if (draftReply.isBlank() || draftReply.length() > MAX_TEXT_LENGTH) {
      throw new IllegalArgumentException("draftReply must be 1-" + MAX_TEXT_LENGTH + " characters");
    }
    duplicateIds = List.copyOf(duplicateIds);
  }
}
