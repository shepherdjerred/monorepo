package com.shepherdjerred.thestorm.agent.app;

import static com.shepherdjerred.thestorm.agent.app.AgentFixtures.ALICE;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.agent.adapter.db.JooqDecisionLog;
import com.shepherdjerred.thestorm.agent.adapter.stub.StubBrainClient;
import com.shepherdjerred.thestorm.agent.app.AgentFixtures.Clock;
import com.shepherdjerred.thestorm.agent.app.AgentFixtures.MemoryChatStore;
import com.shepherdjerred.thestorm.agent.domain.AgentDecision;
import com.shepherdjerred.thestorm.agent.domain.DecisionAction;
import com.shepherdjerred.thestorm.agent.domain.DecisionDraft;
import com.shepherdjerred.thestorm.agent.domain.Offense;
import com.shepherdjerred.thestorm.chat.app.ChatService;
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
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class OverturnFlowTest {

  private static final UUID MOD = UUID.fromString("00000000-0000-0000-0000-00000000000b");

  @TempDir Path directory;

  private final Clock clock = new Clock();
  private final MemoryChatStore chatStore = new MemoryChatStore();

  private StormDatabase database;
  private JooqDecisionLog log;
  private TicketService tickets;
  private ChatService chat;
  private OverturnFlow overturn;

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("storm.db"));
    database.migrate("agent", OverturnFlowTest.class.getClassLoader());
    database.migrate("tickets", OverturnFlowTest.class.getClassLoader());
    log = new JooqDecisionLog(database, "test");
    tickets = new TicketService(new JooqTicketStore(database, "test"), clock);
    chat = AgentFixtures.chatService(chatStore, clock);
    var services =
        new AgentServices(
            StubBrainClient.defaultUncertain(),
            log,
            tickets,
            clock,
            AgentFixtures.config("active", List.of()),
            new Random(1));
    overturn = new OverturnFlow(services, chat);
  }

  @AfterEach
  void close() {
    database.close();
  }

  private AgentDecision record(DecisionAction action, Optional<Long> ticketId) {
    return log.record(
            new DecisionDraft(
                ALICE,
                Offense.SPAM,
                ticketId,
                "spam-burst",
                0.9,
                "gpt-5.6-luna",
                action,
                false,
                false,
                Optional.of(0),
                120L,
                "five identical lines"),
            clock.instant())
        .join();
  }

  private TicketSnapshot filed() {
    var ticket =
        tickets
            .open(new TicketDraft(ALICE, TicketCategory.GRIEF, "my wall is gone", Optional.empty()))
            .join();
    return TicketSnapshots.from(ticket);
  }

  @Test
  void overturnLiftsMutes() {
    chat.mute(ALICE, Duration.ofMinutes(10), "spam-burst", "StormAgent");
    var decision = record(DecisionAction.MUTE, Optional.empty());

    var outcome = overturn.overturn(decision.id(), MOD, "Mod").join();

    assertThat(outcome).isEqualTo(new OverturnFlow.Outcome.Overturned(decision, true));
    assertThat(chat.activeMute(ALICE)).isEmpty();
    assertThat(log.find(decision.id()).join().orElseThrow().overturnedBy()).contains(MOD);
  }

  @Test
  void overturnReportsAlreadyUnmuted() {
    var decision = record(DecisionAction.MUTE, Optional.empty());

    var outcome = overturn.overturn(decision.id(), MOD, "Mod").join();

    assertThat(outcome).isEqualTo(new OverturnFlow.Outcome.Overturned(decision, false));
  }

  @Test
  void warnOverturnMarksWithoutReversal() {
    var decision = record(DecisionAction.WARN, Optional.empty());

    var outcome = overturn.overturn(decision.id(), MOD, "Mod").join();

    assertThat(outcome).isEqualTo(new OverturnFlow.Outcome.Overturned(decision, false));
    assertThat(log.find(decision.id()).join().orElseThrow().overturnedBy()).contains(MOD);
  }

  @Test
  void missingDecisionsReportMissing() {
    assertThat(overturn.overturn(404, MOD, "Mod").join())
        .isEqualTo(new OverturnFlow.Outcome.Missing(404));
  }

  @Test
  void doubleOverturnReportsWhoDidIt() {
    var decision = record(DecisionAction.WARN, Optional.empty());
    overturn.overturn(decision.id(), MOD, "Mod").join();

    assertThat(overturn.overturn(decision.id(), ALICE, "Alice").join())
        .isInstanceOfSatisfying(
            OverturnFlow.Outcome.AlreadyOverturned.class,
            already -> assertThat(already.by()).isEqualTo(MOD));
  }

  @Test
  void ticketLinkedOverturnsNoteTheCorrection() {
    var ticket = filed();
    var decision = record(DecisionAction.ESCALATE, Optional.of(ticket.id()));

    overturn.overturn(decision.id(), MOD, "Mod").join();

    assertThat(tickets.commentSnapshots(ticket.id()).join())
        .extracting(comment -> comment.body())
        .anyMatch(body -> body.contains("Overturned by Mod"));
    assertThat(tickets.commentSnapshots(ticket.id()).join().getFirst().staffOnly()).isTrue();
  }
}
