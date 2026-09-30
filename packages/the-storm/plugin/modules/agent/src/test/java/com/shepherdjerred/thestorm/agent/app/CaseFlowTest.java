package com.shepherdjerred.thestorm.agent.app;

import static com.shepherdjerred.thestorm.agent.app.AgentFixtures.ALICE;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.agent.adapter.db.JooqDecisionLog;
import com.shepherdjerred.thestorm.agent.adapter.stub.StubBrainClient;
import com.shepherdjerred.thestorm.agent.app.AgentFixtures.Clock;
import com.shepherdjerred.thestorm.agent.app.AgentFixtures.MemoryModLog;
import com.shepherdjerred.thestorm.agent.domain.DecisionAction;
import com.shepherdjerred.thestorm.agent.domain.DecisionDraft;
import com.shepherdjerred.thestorm.agent.domain.Offense;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.essentials.app.ModerationService;
import com.shepherdjerred.thestorm.essentials.domain.moderation.Actor;
import com.shepherdjerred.thestorm.essentials.domain.moderation.AuditEntry;
import com.shepherdjerred.thestorm.essentials.domain.moderation.ModerationAction;
import com.shepherdjerred.thestorm.tickets.adapter.db.JooqTicketStore;
import com.shepherdjerred.thestorm.tickets.app.TicketService;
import com.shepherdjerred.thestorm.tickets.app.TicketSnapshots;
import com.shepherdjerred.thestorm.tickets.domain.TicketCategory;
import com.shepherdjerred.thestorm.tickets.domain.TicketDraft;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.Random;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class CaseFlowTest {

  private static final Instant NOW = Instant.parse("2017-06-01T12:00:00Z");

  @TempDir Path directory;

  private final Clock clock = new Clock();
  private final MemoryModLog modLog = new MemoryModLog();

  private StormDatabase database;
  private JooqDecisionLog log;
  private TicketService tickets;

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("storm.db"));
    database.migrate("agent", CaseFlowTest.class.getClassLoader());
    database.migrate("tickets", CaseFlowTest.class.getClassLoader());
    log = new JooqDecisionLog(database, "test");
    tickets = new TicketService(new JooqTicketStore(database, "test"), clock);
  }

  @AfterEach
  void close() {
    database.close();
  }

  private CaseFlow cases(Optional<ModerationService> moderation) {
    var services =
        new AgentServices(
            StubBrainClient.defaultUncertain(),
            log,
            tickets,
            clock,
            AgentFixtures.config("shadow", List.of()),
            new Random(1));
    return new CaseFlow(services, moderation);
  }

  @Test
  void assemblesTicketTrailStandingAndPrecedents() {
    var ticket =
        TicketSnapshots.from(
            tickets
                .open(
                    new TicketDraft(ALICE, TicketCategory.APPEAL, "unfair mute", Optional.empty()))
                .join());
    log.record(
            new DecisionDraft(
                ALICE,
                Offense.OTHER,
                Optional.of(ticket.id()),
                "triage",
                0,
                "stub",
                DecisionAction.ESCALATE,
                true,
                false,
                Optional.empty(),
                0L,
                "below-threshold open"),
            NOW)
        .join();
    log.record(
            new DecisionDraft(
                ALICE,
                Offense.SPAM,
                Optional.empty(),
                "spam-burst",
                0.9,
                "stub",
                DecisionAction.WARN,
                true,
                false,
                Optional.of(0),
                0L,
                "burst"),
            NOW)
        .join();
    modLog.entries.add(
        AuditEntry.of(
            ALICE,
            ModerationAction.KICK,
            Actor.CONSOLE,
            AuditEntry.Term.permanent("griefing", NOW)));
    var moderation = ModerationService.load(modLog, clock);

    var view = cases(Optional.of(moderation)).assemble(ticket.id()).join().orElseThrow();

    assertThat(view.ticket().id()).isEqualTo(ticket.id());
    assertThat(view.ticket().categoryId()).isEqualTo("appeal");
    assertThat(view.trail()).hasSize(1);
    assertThat(view.trail().getFirst().action()).isEqualTo(DecisionAction.ESCALATE);
    assertThat(view.standing().banned()).isFalse();
    assertThat(view.standing().history())
        .extracting(record -> record.actionId())
        .containsExactly("kick");
    assertThat(view.precedents())
        .extracting(row -> row.action())
        .containsExactly(DecisionAction.WARN, DecisionAction.ESCALATE);
  }

  @Test
  void missingTicketsAssembleEmpty() {
    var moderation = ModerationService.load(modLog, clock);

    assertThat(cases(Optional.of(moderation)).assemble(404).join()).isEmpty();
  }

  @Test
  void worksWithoutModeration() {
    var ticket =
        TicketSnapshots.from(
            tickets
                .open(new TicketDraft(ALICE, TicketCategory.GRIEF, "my wall", Optional.empty()))
                .join());

    var view = cases(Optional.empty()).assemble(ticket.id()).join().orElseThrow();

    assertThat(view.standing().banned()).isFalse();
    assertThat(view.standing().history()).isEmpty();
    assertThat(view.trail()).isEmpty();
  }
}
