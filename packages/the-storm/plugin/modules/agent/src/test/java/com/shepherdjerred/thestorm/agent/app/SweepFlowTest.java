package com.shepherdjerred.thestorm.agent.app;

import static com.shepherdjerred.thestorm.agent.app.AgentFixtures.ALICE;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.agent.adapter.db.JooqDecisionLog;
import com.shepherdjerred.thestorm.agent.adapter.stub.StubBrainClient;
import com.shepherdjerred.thestorm.agent.app.AgentFixtures.Clock;
import com.shepherdjerred.thestorm.agent.domain.DecisionAction;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.tickets.adapter.db.JooqTicketStore;
import com.shepherdjerred.thestorm.tickets.app.TicketService;
import com.shepherdjerred.thestorm.tickets.app.TicketSnapshot;
import com.shepherdjerred.thestorm.tickets.app.TicketSnapshots;
import com.shepherdjerred.thestorm.tickets.domain.TicketCategory;
import com.shepherdjerred.thestorm.tickets.domain.TicketDraft;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.Random;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class SweepFlowTest {

  @TempDir Path directory;

  private final Clock clock = new Clock();
  private final RecentChat recents = new RecentChat();

  private StormDatabase database;
  private JooqDecisionLog log;
  private TicketService tickets;

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("storm.db"));
    database.migrate("agent", SweepFlowTest.class.getClassLoader());
    database.migrate("tickets", SweepFlowTest.class.getClassLoader());
    log = new JooqDecisionLog(database, "test");
    tickets = new TicketService(new JooqTicketStore(database, "test"), clock);
  }

  @AfterEach
  void close() {
    database.close();
  }

  private SweepFlow sweep(BrainClient brain, AgentConfig config) {
    var services = new AgentServices(brain, log, tickets, clock, config, new Random(1));
    return new SweepFlow(new TriageFlow(recents, Optional.empty(), services), services);
  }

  private BrainClient workingBrain() {
    return new StubBrainClient(
        kase -> {
          throw new AssertionError("sweep never classifies");
        },
        kase ->
            new TriageProposal(
                "urgent",
                0.9,
                List.of(),
                "blocks are missing",
                "looking into it",
                false,
                "",
                "stub",
                0));
  }

  private BrainClient failingBrain() {
    return new StubBrainClient(
        kase -> {
          throw new AssertionError("sweep never classifies");
        },
        kase -> {
          throw new BrainException("the brain is down");
        });
  }

  private TicketSnapshot filed() {
    var ticket =
        tickets
            .open(new TicketDraft(ALICE, TicketCategory.GRIEF, "my wall is gone", Optional.empty()))
            .join();
    return TicketSnapshots.from(ticket);
  }

  @Test
  void redrivesUntriagedStaleTickets() {
    var flow = sweep(workingBrain(), AgentFixtures.config("active", List.of()));
    var ticket = filed();
    clock.advance(Duration.ofMinutes(11));

    var report = flow.sweep().join();

    assertThat(report.redriven()).isEqualTo(1);
    assertThat(report.failed()).isEqualTo(0);
    var worked = tickets.snapshot(ticket.id()).join().orElseThrow();
    assertThat(worked.triage()).isPresent();
    assertThat(worked.priorityId()).isEqualTo("urgent");
  }

  @Test
  void backsOffFailingRedrives() {
    var flow = sweep(failingBrain(), AgentFixtures.config("active", List.of()));
    filed();
    clock.advance(Duration.ofMinutes(11));

    assertThat(flow.sweep().join().failed()).isEqualTo(1);
    var quiet = flow.sweep().join();
    assertThat(quiet.failed()).isEqualTo(0);
    assertThat(quiet.redriven()).isEqualTo(0);
    clock.advance(Duration.ofMinutes(60));
    assertThat(flow.sweep().join().failed()).isEqualTo(1);
  }

  @Test
  void slaEscalatesAncientTickets() {
    var flow = sweep(workingBrain(), AgentFixtures.config("active", List.of()));
    var ticket = filed();
    // Triage works it; the ticket then sits open past the SLA.
    flow.sweep().join();
    clock.advance(Duration.ofMinutes(241));

    var report = flow.sweep().join();

    assertThat(report.slaBreached()).isEqualTo(1);
    var worked = tickets.snapshot(ticket.id()).join().orElseThrow();
    assertThat(worked.statusId()).isEqualTo("escalated");
    assertThat(tickets.commentSnapshots(ticket.id()).join())
        .extracting(comment -> comment.body())
        .anyMatch(body -> body.contains("sla-breach"));
    var decisions = log.recent(10).join();
    assertThat(decisions)
        .filteredOn(decision -> decision.action() == DecisionAction.ESCALATE)
        .hasSize(1);
    // Escalated tickets leave the sweep alone.
    var again = flow.sweep().join();
    assertThat(again.slaBreached()).isEqualTo(0);
  }

  @Test
  void shadowSuppressesTheSlaTransition() {
    var flow = sweep(workingBrain(), AgentFixtures.config("shadow", List.of()));
    var ticket = filed();
    clock.advance(Duration.ofMinutes(241));

    var report = flow.sweep().join();

    assertThat(report.slaBreached()).isEqualTo(1);
    assertThat(tickets.snapshot(ticket.id()).join().orElseThrow().statusId()).isEqualTo("open");
    var decisions = log.recent(10).join();
    assertThat(decisions).hasSize(1);
    assertThat(decisions.getFirst().action()).isEqualTo(DecisionAction.ESCALATE);
    assertThat(decisions.getFirst().shadow()).isTrue();
    assertThat(decisions.getFirst().note()).contains("would-escalate");
  }

  @Test
  void overlappingSweepsRunOnce() {
    var flow = sweep(workingBrain(), AgentFixtures.config("active", List.of()));
    filed();

    var first = flow.sweep();
    var second = flow.sweep();

    assertThat(first.join().busy()).isFalse();
    assertThat(second.join().busy()).isTrue();
  }

  @Test
  void skipsNonOpenTickets() {
    var flow = sweep(workingBrain(), AgentFixtures.config("active", List.of()));
    var ticket = filed();
    tickets.claim(ticket.id(), ALICE).join();
    clock.advance(Duration.ofDays(9));

    var report = flow.sweep().join();

    assertThat(report).isEqualTo(new SweepFlow.Report(0, 0, 0, false));
  }
}
