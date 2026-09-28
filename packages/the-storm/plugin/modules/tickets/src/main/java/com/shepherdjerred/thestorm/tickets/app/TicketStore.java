package com.shepherdjerred.thestorm.tickets.app;

import com.shepherdjerred.thestorm.tickets.domain.CommentDraft;
import com.shepherdjerred.thestorm.tickets.domain.Ticket;
import com.shepherdjerred.thestorm.tickets.domain.TicketComment;
import com.shepherdjerred.thestorm.tickets.domain.TicketDraft;
import com.shepherdjerred.thestorm.tickets.domain.TicketFilter;
import com.shepherdjerred.thestorm.tickets.domain.Triage;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;

/**
 * Ticket persistence. Every call is asynchronous; the single writer thread applies writes in the
 * order they arrive.
 */
public interface TicketStore {

  /** Files {@code draft} at {@code at}, assigning the next id. */
  CompletableFuture<Ticket> insert(TicketDraft draft, Instant at);

  /** The ticket with {@code id}, with its triage when triaged. */
  CompletableFuture<Optional<Ticket>> find(long id);

  /** Every ticket in {@code filter}, oldest first. */
  CompletableFuture<List<Ticket>> list(TicketFilter filter);

  /** Replaces the stored copy of {@code ticket}. */
  CompletableFuture<Void> save(Ticket ticket);

  /** Adds {@code draft} to ticket {@code ticketId} at {@code at}, assigning the next comment id. */
  CompletableFuture<TicketComment> addComment(long ticketId, CommentDraft draft, Instant at);

  /** Every comment on ticket {@code ticketId}, oldest first. */
  CompletableFuture<List<TicketComment>> comments(long ticketId);

  /** Attaches {@code triage} to ticket {@code ticketId}, replacing any earlier one. */
  CompletableFuture<Void> saveTriage(long ticketId, Triage triage);
}
