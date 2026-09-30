package com.shepherdjerred.thestorm.agent.app;

import com.shepherdjerred.thestorm.agent.domain.AgentDecision;
import com.shepherdjerred.thestorm.essentials.app.ModerationHistory;
import com.shepherdjerred.thestorm.essentials.app.ModerationService;
import com.shepherdjerred.thestorm.tickets.app.TicketSnapshot;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;

/**
 * Assembles a ticket's case for a human reviewer: the ticket, the agent's trail on it, the
 * reporter's standing and recent moderation history, and the reporter's recent agent decisions as
 * precedents. Appeal tickets (UC-7) are the main consumer; any ticket assembles the same way.
 */
public final class CaseFlow {

  /** The reporter's standing, as the case shows it. */
  public record Standing(boolean banned, List<ModerationHistory> history) {}

  /** Everything the reviewer needs on one screen. */
  public record CaseView(
      TicketSnapshot ticket,
      List<AgentDecision> trail,
      Standing standing,
      List<AgentDecision> precedents) {}

  private static final int HISTORY_LINES = 5;
  private static final int PRECEDENT_LINES = 3;

  private final AgentServices services;
  private final Optional<ModerationService> moderation;

  public CaseFlow(AgentServices services, Optional<ModerationService> moderation) {
    this.services = services;
    this.moderation = moderation;
  }

  /** Assembles the case for ticket {@code id}, or empty when it does not exist. */
  public CompletableFuture<Optional<CaseView>> assemble(long id) {
    return services
        .tickets()
        .snapshot(id)
        .thenCompose(
            found -> {
              if (found.isEmpty()) {
                return CompletableFuture.completedFuture(Optional.<CaseView>empty());
              }
              var ticket = found.orElseThrow();
              var trail = services.log().decisionsForTicket(id);
              var precedents = services.log().recentBy(ticket.reporter(), PRECEDENT_LINES);
              var banned =
                  moderation
                      .map(
                          moderate ->
                              moderate.activeBan(ticket.reporter()).thenApply(Optional::isPresent))
                      .orElseGet(() -> CompletableFuture.completedFuture(false));
              var history =
                  moderation
                      .map(moderate -> moderate.historyView(ticket.reporter(), HISTORY_LINES))
                      .orElseGet(() -> CompletableFuture.completedFuture(List.of()));
              return CompletableFuture.allOf(trail, precedents, banned, history)
                  .thenApply(
                      done ->
                          Optional.of(
                              new CaseView(
                                  ticket,
                                  trail.join(),
                                  new Standing(banned.join(), history.join()),
                                  precedents.join())));
            });
  }
}
