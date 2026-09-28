package com.shepherdjerred.thestorm.tickets.domain;

import com.shepherdjerred.thestorm.core.result.Result;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * A player report and its handling. New tickets are open, unclaimed, normal priority, and
 * untriaged; see {@link #open}.
 *
 * @param id the ticket id
 * @param reporter who filed it
 * @param category what it is about
 * @param status where it sits
 * @param priority how urgently it needs attention
 * @param summary what happened, in the reporter's words
 * @param location where it happened, when captured
 * @param createdAt when it was filed
 * @param updatedAt when it last changed
 * @param claimer who owns it, when claimed
 * @param triage the agent's working of it, once triaged
 * @param server which server it belongs to
 */
public record Ticket(
    long id,
    UUID reporter,
    TicketCategory category,
    TicketStatus status,
    TicketPriority priority,
    String summary,
    Optional<TicketLocation> location,
    Instant createdAt,
    Instant updatedAt,
    Optional<UUID> claimer,
    Optional<Triage> triage,
    String server) {

  /** The longest summary kept. */
  public static final int MAX_SUMMARY_LENGTH = 500;

  public Ticket {
    if (summary.isBlank() || summary.length() > MAX_SUMMARY_LENGTH) {
      throw new IllegalArgumentException("summary must be 1-" + MAX_SUMMARY_LENGTH + " characters");
    }
    if (updatedAt.isBefore(createdAt)) {
      throw new IllegalArgumentException("updatedAt must not be before createdAt");
    }
    if (status == TicketStatus.CLAIMED && claimer.isEmpty()) {
      throw new IllegalArgumentException("a claimed ticket needs a claimer");
    }
    if (server.isBlank()) {
      throw new IllegalArgumentException("server must not be blank");
    }
  }

  /** A new untriaged ticket for {@code draft} with {@code id}, filed at {@code at}. */
  public static Ticket open(long id, TicketDraft draft, Instant at, String server) {
    return new Ticket(
        id,
        draft.reporter(),
        draft.category(),
        TicketStatus.OPEN,
        TicketPriority.NORMAL,
        draft.summary(),
        draft.location(),
        at,
        at,
        Optional.empty(),
        Optional.empty(),
        server);
  }

  /**
   * This ticket moved to {@code next} at {@code at}. Reopening clears the claimer; resolving keeps
   * the last claimer as a record of who handled it. Claiming names an owner, so it goes through
   * {@link #claim} instead and fails here.
   */
  public Result<Ticket, TicketError> transitionTo(TicketStatus next, Instant at) {
    if (!status.canTransitionTo(next)) {
      return Result.err(TicketError.ILLEGAL_TRANSITION);
    }
    if (next == TicketStatus.CLAIMED) {
      return Result.err(TicketError.ILLEGAL_TRANSITION);
    }
    var keptClaimer = next == TicketStatus.OPEN ? Optional.<UUID>empty() : claimer;
    return Result.ok(
        new Ticket(
            id,
            reporter,
            category,
            next,
            priority,
            summary,
            location,
            createdAt,
            at,
            keptClaimer,
            triage,
            server));
  }

  /** This ticket claimed by {@code staff} at {@code at}. */
  public Result<Ticket, TicketError> claim(UUID staff, Instant at) {
    if (!status.canTransitionTo(TicketStatus.CLAIMED)) {
      return Result.err(TicketError.ILLEGAL_TRANSITION);
    }
    return Result.ok(
        new Ticket(
            id,
            reporter,
            category,
            TicketStatus.CLAIMED,
            priority,
            summary,
            location,
            createdAt,
            at,
            Optional.of(staff),
            triage,
            server));
  }

  /** This ticket carrying {@code triage}, adopting its priority, at {@code at}. */
  public Ticket withTriage(Triage triage, Instant at) {
    return new Ticket(
        id,
        reporter,
        category,
        status,
        triage.priority(),
        summary,
        location,
        createdAt,
        at,
        claimer,
        Optional.of(triage),
        server);
  }
}
