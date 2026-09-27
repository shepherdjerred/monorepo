package com.shepherdjerred.thestorm.agent.app;

import static com.shepherdjerred.thestorm.agent.app.AgentFixtures.ALICE;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.agent.adapter.db.JooqDecisionLog;
import com.shepherdjerred.thestorm.agent.adapter.stub.StubBrainClient;
import com.shepherdjerred.thestorm.agent.app.AgentFixtures.Clock;
import com.shepherdjerred.thestorm.agent.domain.AgentDecision;
import com.shepherdjerred.thestorm.agent.domain.DecisionAction;
import com.shepherdjerred.thestorm.agent.domain.DecisionDraft;
import com.shepherdjerred.thestorm.agent.domain.Offense;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.tickets.adapter.db.JooqTicketStore;
import com.shepherdjerred.thestorm.tickets.app.TicketService;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
import java.util.Random;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class EndorseFlowTest {

  private static final UUID MOD = UUID.fromString("00000000-0000-0000-0000-00000000000b");

  @TempDir Path directory;

  private final Clock clock = new Clock();

  private StormDatabase database;
  private JooqDecisionLog log;
  private EndorseFlow endorse;

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("storm.db"));
    database.migrate("agent", EndorseFlowTest.class.getClassLoader());
    database.migrate("tickets", EndorseFlowTest.class.getClassLoader());
    log = new JooqDecisionLog(database, "test");
    var tickets = new TicketService(new JooqTicketStore(database, "test"), clock);
    var services =
        new AgentServices(
            StubBrainClient.defaultUncertain(),
            log,
            tickets,
            clock,
            AgentFixtures.config("active", List.of()),
            new Random(1));
    endorse = new EndorseFlow(services);
  }

  @AfterEach
  void close() {
    database.close();
  }

  private AgentDecision record(DecisionAction action) {
    return log.record(
            new DecisionDraft(
                ALICE,
                Offense.SPAM,
                Optional.empty(),
                "spam-burst",
                0.9,
                "gpt-5.6-luna",
                action,
                false,
                true,
                Optional.of(0),
                120L,
                "five identical lines"),
            clock.instant())
        .join();
  }

  @Test
  void endorseMarksTheDecision() {
    var decision = record(DecisionAction.MUTE);

    var outcome = endorse.endorse(decision.id(), MOD).join();

    assertThat(outcome).isEqualTo(new EndorseFlow.Outcome.Endorsed(decision));
    assertThat(log.find(decision.id()).join().orElseThrow().endorsedBy()).contains(MOD);
  }

  @Test
  void missingDecisionsReportMissing() {
    assertThat(endorse.endorse(404, MOD).join()).isEqualTo(new EndorseFlow.Outcome.Missing(404));
  }

  @Test
  void doubleEndorseReportsWhoDidIt() {
    var decision = record(DecisionAction.WARN);
    endorse.endorse(decision.id(), MOD).join();

    assertThat(endorse.endorse(decision.id(), ALICE).join())
        .isInstanceOfSatisfying(
            EndorseFlow.Outcome.AlreadyEndorsed.class,
            already -> assertThat(already.by()).isEqualTo(MOD));
  }

  @Test
  void overturnedRowsCannotBeEndorsed() {
    var decision = record(DecisionAction.MUTE);
    log.overturn(decision.id(), ALICE, clock.instant()).join();

    var outcome = endorse.endorse(decision.id(), MOD).join();

    assertThat(outcome)
        .isInstanceOfSatisfying(
            EndorseFlow.Outcome.AlreadyOverturned.class,
            already -> assertThat(already.by()).isEqualTo(ALICE));
    assertThat(log.find(decision.id()).join().orElseThrow().endorsedBy()).isEmpty();
  }
}
