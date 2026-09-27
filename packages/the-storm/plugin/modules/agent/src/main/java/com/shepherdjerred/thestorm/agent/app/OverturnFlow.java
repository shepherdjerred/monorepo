package com.shepherdjerred.thestorm.agent.app;

import com.shepherdjerred.thestorm.agent.domain.AgentDecision;
import com.shepherdjerred.thestorm.chat.app.ChatService;
import com.shepherdjerred.thestorm.tickets.app.TicketService;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Reverses agent decisions at reviewer request. Mutes lift; warns, kicks, allows, and escalations
 * have nothing to undo — overturning an escalation dismisses it from the review queue. Every
 * overturn marks the row and, for ticket-linked decisions, notes the correction on the ticket, so
 * bad patterns stay findable for ladder and prompt review.
 */
public final class OverturnFlow {

  /** What overturning reported. */
  public sealed interface Outcome {

    /** No decision with that id. */
    record Missing(long id) implements Outcome {}

    /** Already overturned; states who did it. */
    record AlreadyOverturned(AgentDecision decision, UUID by) implements Outcome {}

    /** Overturned; states what was undone. */
    record Overturned(AgentDecision decision, boolean liftedMute) implements Outcome {}
  }

  private final AgentServices services;
  private final ChatService chat;

  public OverturnFlow(AgentServices services, ChatService chat) {
    this.services = services;
    this.chat = chat;
  }

  /** Overturns decision {@code id} as {@code staff}. */
  public CompletableFuture<Outcome> overturn(long id, UUID staff, String staffName) {
    return services
        .log()
        .find(id)
        .thenCompose(
            found -> {
              if (found.isEmpty()) {
                return CompletableFuture.completedFuture(new Outcome.Missing(id));
              }
              var decision = found.orElseThrow();
              if (decision.overturnedBy().isPresent()) {
                return CompletableFuture.completedFuture(
                    new Outcome.AlreadyOverturned(decision, decision.overturnedBy().orElseThrow()));
              }
              return reverse(decision, staff, staffName);
            });
  }

  private CompletableFuture<Outcome> reverse(AgentDecision decision, UUID staff, String staffName) {
    var lifted =
        switch (decision.action()) {
          case MUTE -> chat.unmute(decision.player());
          // The agent never executes tempbans; the review ticket is the record.
          case WARN, KICK, TEMPBAN, ALLOW, ESCALATE -> false;
        };
    // The row existed a moment ago and rows are never deleted, so the mark lands.
    return services
        .log()
        .overturn(decision.id(), staff, services.time().instant())
        .thenCompose(marked -> note(decision, staffName, lifted))
        .thenApply(done -> new Outcome.Overturned(decision, lifted));
  }

  private CompletableFuture<Void> note(AgentDecision decision, String staffName, boolean lifted) {
    Optional<Long> ticket = decision.ticketId();
    if (ticket.isEmpty()) {
      return CompletableFuture.completedFuture(null);
    }
    var correction =
        "Overturned by "
            + staffName
            + ": "
            + decision.action().id()
            + " for "
            + decision.offense().id()
            + " (decision #"
            + decision.id()
            + ")"
            + (lifted ? "; mute lifted." : ".");
    return services
        .tickets()
        .addAgentComment(
            ticket.orElseThrow(), Notes.clip(correction, TicketService.MAX_AGENT_COMMENT), true)
        .thenApply(noted -> null);
  }
}
