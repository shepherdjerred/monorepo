package com.shepherdjerred.thestorm.tickets.app;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.tickets.domain.CommentDraft;
import com.shepherdjerred.thestorm.tickets.domain.Ticket;
import com.shepherdjerred.thestorm.tickets.domain.TicketCategory;
import com.shepherdjerred.thestorm.tickets.domain.TicketComment;
import com.shepherdjerred.thestorm.tickets.domain.TicketDraft;
import com.shepherdjerred.thestorm.tickets.domain.TicketError;
import com.shepherdjerred.thestorm.tickets.domain.TicketFilter;
import com.shepherdjerred.thestorm.tickets.domain.TicketPriority;
import com.shepherdjerred.thestorm.tickets.domain.TicketStatus;
import com.shepherdjerred.thestorm.tickets.domain.Triage;
import java.nio.charset.StandardCharsets;
import java.time.InstantSource;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

/**
 * The ticket queue. Reads always hit storage, so every caller sees the latest state; concurrent
 * edits are last-write-wins, which the tiny ticket volume makes acceptable. Every change emits an
 * event after its write succeeds.
 *
 * <p>The domain-typed methods are for this module's own adapters. Other modules work through the
 * snapshots and the agent-facing writes, which validate untrusted input and never leak domain
 * types.
 */
public final class TicketService {

  /** Who files and writes the agent's own tickets. */
  public static final UUID SYSTEM_REPORTER =
      UUID.nameUUIDFromBytes("thestorm:agent".getBytes(StandardCharsets.UTF_8));

  /** The longest agent comment or resolution note kept; callers clip longer text. */
  public static final int MAX_AGENT_COMMENT = TicketComment.MAX_BODY_LENGTH;

  /** The longest agent triage evidence or draft reply kept; callers clip longer text. */
  public static final int MAX_AGENT_TRIAGE_TEXT = Triage.MAX_TEXT_LENGTH;

  private final TicketStore store;
  private final InstantSource time;
  private final List<Consumer<TicketEvent>> listeners = new CopyOnWriteArrayList<>();

  public TicketService(TicketStore store, InstantSource time) {
    this.store = store;
    this.time = time;
  }

  /**
   * Runs {@code listener} on every ticket event, on the thread that made the change. Listeners must
   * not throw and must not touch the Bukkit API; chat-driven events arrive off the main thread.
   */
  public void addListener(Consumer<TicketEvent> listener) {
    listeners.add(listener);
  }

  /** Stops running {@code listener} on ticket events. */
  public void removeListener(Consumer<TicketEvent> listener) {
    listeners.remove(listener);
  }

  /** Files {@code draft} and returns it with its id. */
  public CompletableFuture<Ticket> open(TicketDraft draft) {
    return store.insert(draft, time.instant()).thenApply(this::opened);
  }

  /** The ticket with {@code id}, when it exists. */
  public CompletableFuture<Optional<Ticket>> get(long id) {
    return store.find(id);
  }

  /** Every ticket in {@code filter}, oldest first. */
  public CompletableFuture<List<Ticket>> list(TicketFilter filter) {
    return store.list(filter);
  }

  /** Every comment on ticket {@code id}, oldest first. */
  public CompletableFuture<List<TicketComment>> comments(long id) {
    return store.comments(id);
  }

  /** Adds {@code draft} to ticket {@code id}. */
  public CompletableFuture<Result<TicketComment, TicketError>> comment(
      long id, CommentDraft draft) {
    return store
        .find(id)
        .thenCompose(
            found ->
                found.isEmpty()
                    ? CompletableFuture.completedFuture(Result.err(TicketError.TICKET_NOT_FOUND))
                    : store.addComment(id, draft, time.instant()).thenApply(Result::ok));
  }

  /** Moves ticket {@code id} to {@code next}. */
  public CompletableFuture<Result<Ticket, TicketError>> transition(long id, TicketStatus next) {
    return store
        .find(id)
        .thenCompose(
            found -> {
              if (found.isEmpty()) {
                return CompletableFuture.completedFuture(Result.err(TicketError.TICKET_NOT_FOUND));
              }
              var moved = found.orElseThrow().transitionTo(next, time.instant());
              return switch (moved) {
                case Result.Ok<Ticket, TicketError>(var ticket) ->
                    store.save(ticket).thenApply(saved -> Result.ok(moved(ticket)));
                case Result.Err<Ticket, TicketError>(var error) ->
                    CompletableFuture.completedFuture(Result.err(error));
              };
            });
  }

  /** Claims ticket {@code id} for {@code staff}. */
  public CompletableFuture<Result<Ticket, TicketError>> claim(long id, UUID staff) {
    return store
        .find(id)
        .thenCompose(
            found -> {
              if (found.isEmpty()) {
                return CompletableFuture.completedFuture(Result.err(TicketError.TICKET_NOT_FOUND));
              }
              var claimed = found.orElseThrow().claim(staff, time.instant());
              return switch (claimed) {
                case Result.Ok<Ticket, TicketError>(var ticket) ->
                    store.save(ticket).thenApply(saved -> Result.ok(claimed(ticket)));
                case Result.Err<Ticket, TicketError>(var error) ->
                    CompletableFuture.completedFuture(Result.err(error));
              };
            });
  }

  /** Attaches {@code triage} to ticket {@code id}, adopting its priority. */
  public CompletableFuture<Result<Ticket, TicketError>> triage(long id, Triage triage) {
    return store
        .find(id)
        .thenCompose(
            found -> {
              if (found.isEmpty()) {
                return CompletableFuture.completedFuture(Result.err(TicketError.TICKET_NOT_FOUND));
              }
              var ticket = found.orElseThrow().withTriage(triage, time.instant());
              return store
                  .save(ticket)
                  .thenCompose(saved -> store.saveTriage(id, triage))
                  .thenApply(saved -> Result.ok(triaged(ticket)));
            });
  }

  /** The snapshot of ticket {@code id}, when it exists. */
  public CompletableFuture<Optional<TicketSnapshot>> snapshot(long id) {
    return store.find(id).thenApply(found -> found.map(TicketSnapshots::from));
  }

  /** Snapshots of every open ticket, oldest first, for the agent sweep. */
  public CompletableFuture<List<TicketSnapshot>> openSnapshots() {
    return store
        .list(TicketFilter.open())
        .thenApply(tickets -> tickets.stream().map(TicketSnapshots::from).toList());
  }

  /** Every comment snapshot on ticket {@code id}, oldest first. */
  public CompletableFuture<List<CommentSnapshot>> commentSnapshots(long id) {
    return store
        .comments(id)
        .thenApply(comments -> comments.stream().map(TicketSnapshots::from).toList());
  }

  /**
   * Files a ticket from the agent, for example an enforcement escalation. The reporter is always
   * the system reporter; the agent never files as a player.
   */
  public CompletableFuture<Result<TicketSnapshot, TicketFailure>> openAgentReport(
      String categoryId, String summary) {
    TicketDraft draft;
    try {
      draft =
          new TicketDraft(
              SYSTEM_REPORTER, TicketCategory.fromId(categoryId), summary, Optional.empty());
    } catch (IllegalArgumentException invalid) {
      return CompletableFuture.completedFuture(Result.err(TicketFailure.INVALID_INPUT));
    }
    return open(draft).thenApply(ticket -> Result.ok(TicketSnapshots.from(ticket)));
  }

  /** Adds a system comment to ticket {@code id}, staff-only when {@code staffOnly}. */
  public CompletableFuture<Result<CommentSnapshot, TicketFailure>> addAgentComment(
      long id, String body, boolean staffOnly) {
    CommentDraft draft;
    try {
      draft = new CommentDraft(SYSTEM_REPORTER, staffOnly, body);
    } catch (IllegalArgumentException invalid) {
      return CompletableFuture.completedFuture(Result.err(TicketFailure.INVALID_INPUT));
    }
    return comment(id, draft)
        .thenApply(
            added ->
                switch (added) {
                  case Result.Ok<TicketComment, TicketError>(var comment) ->
                      Result.ok(TicketSnapshots.from(comment));
                  case Result.Err<TicketComment, TicketError> _ ->
                      Result.err(TicketFailure.TICKET_NOT_FOUND);
                });
  }

  /** Attaches the agent's triage to ticket {@code id}, adopting its priority. */
  public CompletableFuture<Result<TicketSnapshot, TicketFailure>> attachAgentTriage(
      long id, AgentTriage agentTriage) {
    Triage triage;
    try {
      triage =
          new Triage(
              TicketPriority.fromId(agentTriage.priorityId()),
              agentTriage.duplicateIds(),
              agentTriage.evidence(),
              agentTriage.draftReply(),
              time.instant());
    } catch (IllegalArgumentException invalid) {
      return CompletableFuture.completedFuture(Result.err(TicketFailure.INVALID_INPUT));
    }
    return triage(id, triage)
        .thenApply(
            attached ->
                switch (attached) {
                  case Result.Ok<Ticket, TicketError>(var ticket) ->
                      Result.ok(TicketSnapshots.from(ticket));
                  case Result.Err<Ticket, TicketError> _ ->
                      Result.err(TicketFailure.TICKET_NOT_FOUND);
                });
  }

  /** Resolves ticket {@code id} with a public note from the agent. */
  public CompletableFuture<Result<TicketSnapshot, TicketFailure>> resolveAgentTicket(
      long id, String publicNote) {
    CommentDraft note;
    try {
      note = new CommentDraft(SYSTEM_REPORTER, false, publicNote);
    } catch (IllegalArgumentException invalid) {
      return CompletableFuture.completedFuture(Result.err(TicketFailure.INVALID_INPUT));
    }
    return transition(id, TicketStatus.RESOLVED)
        .thenCompose(
            moved ->
                switch (moved) {
                  case Result.Ok<Ticket, TicketError>(var ticket) ->
                      comment(id, note).thenApply(noted -> Result.ok(TicketSnapshots.from(ticket)));
                  case Result.Err<Ticket, TicketError> _ ->
                      CompletableFuture.completedFuture(Result.err(TicketFailure.INVALID_INPUT));
                });
  }

  /** Escalates ticket {@code id} to human review with a staff-only note from the agent. */
  public CompletableFuture<Result<TicketSnapshot, TicketFailure>> escalateAgentTicket(
      long id, String staffNote) {
    CommentDraft note;
    try {
      note = new CommentDraft(SYSTEM_REPORTER, true, staffNote);
    } catch (IllegalArgumentException invalid) {
      return CompletableFuture.completedFuture(Result.err(TicketFailure.INVALID_INPUT));
    }
    return transition(id, TicketStatus.ESCALATED)
        .thenCompose(
            moved ->
                switch (moved) {
                  case Result.Ok<Ticket, TicketError>(var ticket) ->
                      comment(id, note).thenApply(noted -> Result.ok(TicketSnapshots.from(ticket)));
                  case Result.Err<Ticket, TicketError> _ ->
                      CompletableFuture.completedFuture(Result.err(TicketFailure.INVALID_INPUT));
                });
  }

  private void emit(TicketEvent event) {
    for (var listener : listeners) {
      listener.accept(event);
    }
  }

  private Ticket opened(Ticket ticket) {
    emit(new TicketEvent.Opened(TicketSnapshots.from(ticket)));
    return ticket;
  }

  private Ticket claimed(Ticket ticket) {
    emit(new TicketEvent.Claimed(TicketSnapshots.from(ticket)));
    return ticket;
  }

  private Ticket triaged(Ticket ticket) {
    emit(new TicketEvent.Triaged(TicketSnapshots.from(ticket)));
    return ticket;
  }

  private Ticket moved(Ticket ticket) {
    switch (ticket.status()) {
      case OPEN -> emit(new TicketEvent.Reopened(TicketSnapshots.from(ticket)));
      case CLAIMED -> emit(new TicketEvent.Claimed(TicketSnapshots.from(ticket)));
      case ESCALATED -> emit(new TicketEvent.Escalated(TicketSnapshots.from(ticket)));
      case RESOLVED -> emit(new TicketEvent.Resolved(TicketSnapshots.from(ticket)));
    }
    return ticket;
  }
}
