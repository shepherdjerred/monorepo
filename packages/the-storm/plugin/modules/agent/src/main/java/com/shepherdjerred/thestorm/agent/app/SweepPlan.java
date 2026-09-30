package com.shepherdjerred.thestorm.agent.app;

import com.shepherdjerred.thestorm.tickets.app.TicketService;
import com.shepherdjerred.thestorm.tickets.app.TicketSnapshot;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

/**
 * What one sweep does about one ticket. Pure: the same ticket, clock, config, and memories always
 * plan the same action, so the policy is unit-testable without a database.
 */
public final class SweepPlan {

  /** {@code TicketStatus.OPEN.id()}; app code meets other modules through ids, not their enums. */
  private static final String OPEN = "open";

  /** Work a ticket again, or escalate it to a human. */
  public sealed interface Action permits Action.Redrive, Action.SlaBreach {

    /** Work the ticket through triage again. */
    record Redrive(TicketSnapshot ticket) implements Action {}

    /** Escalate the ticket: it has waited past the SLA. */
    record SlaBreach(TicketSnapshot ticket) implements Action {}
  }

  private SweepPlan() {}

  /**
   * What the sweep remembers about one ticket: its last re-drive and whether it already escalated
   * it.
   */
  public record Memories(Optional<Instant> lastRedrive, boolean slaFlagged) {}

  /** Plans the sweep's action for {@code ticket}. */
  public static Optional<Action> plan(
      TicketSnapshot ticket, Instant now, AgentConfig.SweepFile sweep, Memories memories) {
    if (!OPEN.equals(ticket.statusId())) {
      return Optional.empty();
    }
    if (ticket.reporter().equals(TicketService.SYSTEM_REPORTER)) {
      return Optional.empty();
    }
    var age = Duration.between(ticket.createdAt(), now);
    if (!memories.slaFlagged() && !age.minusMinutes(sweep.slaAfterMinutes()).isNegative()) {
      return Optional.of(new Action.SlaBreach(ticket));
    }
    if (ticket.triage().isEmpty() && !age.minusMinutes(sweep.redriveAfterMinutes()).isNegative()) {
      var rested =
          memories.lastRedrive().isEmpty()
              || !Duration.between(memories.lastRedrive().orElseThrow(), now)
                  .minusMinutes(sweep.redriveBackoffMinutes())
                  .isNegative();
      if (rested) {
        return Optional.of(new Action.Redrive(ticket));
      }
    }
    return Optional.empty();
  }
}
