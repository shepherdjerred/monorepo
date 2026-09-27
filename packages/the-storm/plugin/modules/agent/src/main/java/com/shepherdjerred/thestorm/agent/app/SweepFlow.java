package com.shepherdjerred.thestorm.agent.app;

import com.shepherdjerred.thestorm.agent.domain.AgentDecision;
import com.shepherdjerred.thestorm.agent.domain.DecisionAction;
import com.shepherdjerred.thestorm.agent.domain.DecisionDraft;
import com.shepherdjerred.thestorm.agent.domain.Offense;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.tickets.app.TicketEvent;
import com.shepherdjerred.thestorm.tickets.app.TicketFailure;
import com.shepherdjerred.thestorm.tickets.app.TicketService;
import com.shepherdjerred.thestorm.tickets.app.TicketSnapshot;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Re-drives stale tickets and escalates SLA breaches. The sweep runs on boot and on the configured
 * interval while the server is awake; each ticket is planned in isolation, so one broken ticket
 * never kills the sweep. Memories are in-process: a restart re-drives once more at worst, and
 * transitions make active-mode escalations durable.
 */
public final class SweepFlow {

  /** What one sweep did. */
  public record Report(int redriven, int slaBreached, int failed, boolean busy) {}

  private final TriageFlow triage;
  private final AgentServices services;
  private final Map<Long, Instant> lastRedrive = new ConcurrentHashMap<>();
  private final Set<Long> slaFlagged = ConcurrentHashMap.newKeySet();
  private final AtomicBoolean running = new AtomicBoolean();

  public SweepFlow(TriageFlow triage, AgentServices services) {
    this.triage = triage;
    this.services = services;
  }

  /** Sweeps once. A sweep already running completes immediately as busy. */
  public CompletableFuture<Report> sweep() {
    if (!running.compareAndSet(false, true)) {
      return CompletableFuture.completedFuture(new Report(0, 0, 0, true));
    }
    return services
        .tickets()
        .openSnapshots()
        .thenCompose(
            tickets -> {
              var now = services.time().instant();
              var runs = tickets.stream().map(ticket -> runOne(ticket, now)).toList();
              return CompletableFuture.allOf(runs.toArray(CompletableFuture[]::new))
                  .thenApply(
                      done ->
                          new Report(
                              count(runs, Outcome.REDRIVEN),
                              count(runs, Outcome.SLA_BREACHED),
                              count(runs, Outcome.FAILED),
                              false));
            })
        .whenComplete((report, failure) -> running.set(false));
  }

  private CompletableFuture<Outcome> runOne(TicketSnapshot ticket, Instant now) {
    var planned =
        SweepPlan.plan(
            ticket,
            now,
            services.config().sweep(),
            new SweepPlan.Memories(
                Optional.ofNullable(lastRedrive.get(ticket.id())),
                slaFlagged.contains(ticket.id())));
    if (planned.isEmpty()) {
      return CompletableFuture.completedFuture(Outcome.SKIPPED);
    }
    try {
      var run =
          switch (planned.orElseThrow()) {
            case SweepPlan.Action.Redrive(var redriven) -> redrive(redriven, now);
            case SweepPlan.Action.SlaBreach(var breached) -> slaBreach(breached, now);
          };
      return run.handle((outcome, failure) -> failure == null ? outcome : Outcome.FAILED);
    } catch (RuntimeException sync) {
      return CompletableFuture.completedFuture(Outcome.FAILED);
    }
  }

  private CompletableFuture<Outcome> redrive(TicketSnapshot ticket, Instant now) {
    lastRedrive.put(ticket.id(), now);
    return triage.onEvent(new TicketEvent.Opened(ticket)).thenApply(done -> Outcome.REDRIVEN);
  }

  private CompletableFuture<Outcome> slaBreach(TicketSnapshot ticket, Instant now) {
    var age = Duration.between(ticket.createdAt(), now);
    if (services.config().shadow()) {
      return record(ticket, "would-escalate sla-breach: open " + ageText(age), now)
          .thenApply(
              done -> {
                slaFlagged.add(ticket.id());
                return Outcome.SLA_BREACHED;
              });
    }
    var note = "sla-breach: open " + ageText(age) + " with no resolution";
    return services
        .tickets()
        .escalateAgentTicket(ticket.id(), Notes.clip(note, TicketService.MAX_AGENT_COMMENT))
        .thenCompose(
            moved ->
                switch (moved) {
                  case Result.Ok<TicketSnapshot, TicketFailure>(var escalated) ->
                      record(escalated, note, now)
                          .thenApply(
                              done -> {
                                slaFlagged.add(ticket.id());
                                return Outcome.SLA_BREACHED;
                              });
                  // The ticket moved on while the sweep ran; nothing to do.
                  case Result.Err<TicketSnapshot, TicketFailure> _ ->
                      CompletableFuture.completedFuture(Outcome.SKIPPED);
                });
  }

  private CompletableFuture<AgentDecision> record(TicketSnapshot ticket, String note, Instant now) {
    return services
        .log()
        .record(
            new DecisionDraft(
                ticket.reporter(),
                Offense.OTHER,
                Optional.of(ticket.id()),
                "triage",
                1,
                "sweep",
                DecisionAction.ESCALATE,
                services.config().shadow(),
                // Sweep rows queue by action as escalations; sampling them too
                // would list them twice.
                false,
                Optional.empty(),
                0,
                Notes.clip(note, AgentDecision.MAX_NOTE_LENGTH)),
            now);
  }

  private static int count(List<CompletableFuture<Outcome>> runs, Outcome want) {
    return (int) runs.stream().filter(run -> run.join() == want).count();
  }

  private static String ageText(Duration age) {
    var minutes = age.toMinutes();
    if (minutes < 120) {
      return minutes + "m";
    }
    var hours = age.toHours();
    if (hours < 48) {
      return hours + "h";
    }
    return age.toDays() + "d";
  }

  private enum Outcome {
    REDRIVEN,
    SLA_BREACHED,
    SKIPPED,
    FAILED
  }
}
