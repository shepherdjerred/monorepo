package com.shepherdjerred.thestorm.agent.app;

import static com.shepherdjerred.thestorm.agent.app.AgentFixtures.ALICE;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.tickets.app.TicketService;
import com.shepherdjerred.thestorm.tickets.app.TicketSnapshot;
import com.shepherdjerred.thestorm.tickets.app.TriageSnapshot;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class SweepPlanTest {

  private static final Instant NOW = Instant.parse("2017-06-01T12:00:00Z");
  private static final AgentConfig.SweepFile SWEEP = new AgentConfig.SweepFile(15, 10, 60, 240);

  @Test
  void skipsNonOpenTickets() {
    for (var status : List.of("claimed", "escalated", "resolved")) {
      var ticket = ticket(status, false, Duration.ofDays(9));

      assertThat(plan(ticket)).isEmpty();
    }
  }

  @Test
  void skipsAgentReports() {
    var ticket =
        new TicketSnapshot(
            1,
            TicketService.SYSTEM_REPORTER,
            "other",
            "open",
            "normal",
            "escalation",
            Optional.empty(),
            NOW.minus(Duration.ofDays(9)),
            NOW.minus(Duration.ofDays(9)),
            Optional.empty(),
            Optional.empty(),
            "test");

    assertThat(plan(ticket)).isEmpty();
  }

  @Test
  void redrivesStaleUntriagedTickets() {
    var ticket = ticket("open", false, Duration.ofMinutes(11));

    assertThat(plan(ticket)).contains(new SweepPlan.Action.Redrive(ticket));
  }

  @Test
  void youngTicketsWait() {
    var ticket = ticket("open", false, Duration.ofMinutes(9));

    assertThat(plan(ticket)).isEmpty();
  }

  @Test
  void triagedTicketsAreWorked() {
    var ticket = ticket("open", true, Duration.ofMinutes(11));

    assertThat(plan(ticket)).isEmpty();
  }

  @Test
  void respectsRedriveBackoff() {
    var ticket = ticket("open", false, Duration.ofMinutes(70));

    assertThat(plan(ticket, Optional.of(NOW.minus(Duration.ofMinutes(59))), false)).isEmpty();
    assertThat(plan(ticket, Optional.of(NOW.minus(Duration.ofMinutes(60))), false))
        .contains(new SweepPlan.Action.Redrive(ticket));
  }

  @Test
  void slaWinsTies() {
    var ticket = ticket("open", false, Duration.ofMinutes(241));

    assertThat(plan(ticket)).contains(new SweepPlan.Action.SlaBreach(ticket));
  }

  @Test
  void slaFiresOnStuckTriagedTickets() {
    var ticket = ticket("open", true, Duration.ofMinutes(241));

    assertThat(plan(ticket)).contains(new SweepPlan.Action.SlaBreach(ticket));
  }

  @Test
  void flaggedTicketsSkipSlaButStillRedrive() {
    var untriaged = ticket("open", false, Duration.ofMinutes(241));
    var triaged = ticket("open", true, Duration.ofMinutes(241));

    // Shadow mode never moves the ticket, so an sla-flagged ticket keeps its triage retries.
    assertThat(plan(untriaged, Optional.empty(), true))
        .contains(new SweepPlan.Action.Redrive(untriaged));
    assertThat(plan(triaged, Optional.empty(), true)).isEmpty();
  }

  private static Optional<SweepPlan.Action> plan(TicketSnapshot ticket) {
    return plan(ticket, Optional.empty(), false);
  }

  private static Optional<SweepPlan.Action> plan(
      TicketSnapshot ticket, Optional<Instant> lastRedrive, boolean slaFlagged) {
    return SweepPlan.plan(ticket, NOW, SWEEP, new SweepPlan.Memories(lastRedrive, slaFlagged));
  }

  private static TicketSnapshot ticket(String status, boolean triaged, Duration age) {
    var at = NOW.minus(age);
    return new TicketSnapshot(
        1,
        ALICE,
        "grief",
        status,
        "normal",
        "my wall is gone",
        Optional.empty(),
        at,
        at,
        Optional.empty(),
        triaged
            ? Optional.of(new TriageSnapshot("normal", List.of(), "blocks missing", "looking", at))
            : Optional.empty(),
        "test");
  }
}
