package com.shepherdjerred.thestorm.agent.app;

import static com.shepherdjerred.thestorm.agent.app.AgentFixtures.ALICE;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.agent.adapter.db.JooqDecisionLog;
import com.shepherdjerred.thestorm.agent.adapter.stub.StubBrainClient;
import com.shepherdjerred.thestorm.agent.app.AgentFixtures.Clock;
import com.shepherdjerred.thestorm.agent.domain.DecisionAction;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.tickets.adapter.db.JooqTicketStore;
import com.shepherdjerred.thestorm.tickets.app.TicketEvent;
import com.shepherdjerred.thestorm.tickets.app.TicketFailure;
import com.shepherdjerred.thestorm.tickets.app.TicketService;
import com.shepherdjerred.thestorm.tickets.app.TicketSnapshot;
import com.shepherdjerred.thestorm.tickets.app.TicketSnapshots;
import com.shepherdjerred.thestorm.tickets.domain.TicketCategory;
import com.shepherdjerred.thestorm.tickets.domain.TicketDraft;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Random;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class FaqFlowTest {

  @TempDir Path directory;

  private final Clock clock = new Clock();
  private final FaqMemory memory = new FaqMemory();

  private StormDatabase database;
  private JooqDecisionLog log;
  private TicketService tickets;

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("storm.db"));
    database.migrate("agent", FaqFlowTest.class.getClassLoader());
    database.migrate("tickets", FaqFlowTest.class.getClassLoader());
    log = new JooqDecisionLog(database, "test");
    tickets = new TicketService(new JooqTicketStore(database, "test"), clock);
  }

  @AfterEach
  void close() {
    database.close();
  }

  private FaqFlow flow(AgentConfig config) {
    return new FaqFlow(
        memory,
        new AgentServices(
            StubBrainClient.defaultUncertain(), log, tickets, clock, config, new Random(1)));
  }

  private AgentConfig catalog(String mode) {
    return AgentFixtures.faqConfig(
        mode,
        List.of(
            AgentFixtures.faqEntry("starter-kit", "starter kit", "You get a kit. It is nice."),
            AgentFixtures.faqEntry("server-rules", "rules", "Read /rules.")));
  }

  private TicketSnapshot filed(String summary) {
    var ticket =
        tickets
            .open(new TicketDraft(ALICE, TicketCategory.OTHER, summary, Optional.empty()))
            .join();
    return TicketSnapshots.from(ticket);
  }

  @Test
  void knownQuestionsGetTheReply() {
    var faq = flow(catalog("active"));
    var ticket = filed("where is my starter kit");

    faq.onEvent(new TicketEvent.Opened(ticket)).join();

    var comments = tickets.commentSnapshots(ticket.id()).join();
    assertThat(comments).hasSize(1);
    assertThat(comments.getFirst().body()).contains("You get a kit.");
    assertThat(comments.getFirst().body()).contains("Storm FAQ: starter-kit");
    assertThat(comments.getFirst().staffOnly()).isFalse();
    var decisions = log.recent(10).join();
    assertThat(decisions).hasSize(1);
    assertThat(decisions.getFirst().action()).isEqualTo(DecisionAction.ALLOW);
    assertThat(decisions.getFirst().classification()).isEqualTo("faq");
    assertThat(decisions.getFirst().note()).isEqualTo("replied starter-kit full");
  }

  @Test
  void thirdStrikesGetTheShortVersion() {
    var faq = flow(catalog("active"));

    var notes = new ArrayList<String>();
    var bodies = new ArrayList<String>();
    for (var i = 0; i < 3; i++) {
      var ticket = filed("where is my starter kit " + i);
      faq.onEvent(new TicketEvent.Opened(ticket)).join();
      notes.add(log.recent(10).join().getFirst().note());
      bodies.add(tickets.commentSnapshots(ticket.id()).join().getFirst().body());
    }

    assertThat(notes)
        .containsExactly(
            "replied starter-kit full", "replied starter-kit full", "replied starter-kit cut");
    assertThat(bodies.get(2)).contains("the short version");
    assertThat(bodies.get(2)).contains("You get a kit.");
    assertThat(bodies.get(2)).doesNotContain("It is nice.");
  }

  @Test
  void strikesCutEvenAsSecondsPassBetweenAskings() {
    var faq = flow(catalog("active"));

    var notes = new ArrayList<String>();
    for (var i = 0; i < 3; i++) {
      clock.advance(Duration.ofSeconds(20));
      var ticket = filed("where is my starter kit " + i);
      faq.onEvent(new TicketEvent.Opened(ticket)).join();
      notes.add(log.recent(10).join().getFirst().note());
    }

    assertThat(notes)
        .containsExactly(
            "replied starter-kit full", "replied starter-kit full", "replied starter-kit cut");
  }

  @Test
  void decayForgivesOldStrikes() {
    var faq = flow(catalog("active"));
    var first = filed("where is my starter kit");
    faq.onEvent(new TicketEvent.Opened(first)).join();
    var second = filed("where is my starter kit again");
    faq.onEvent(new TicketEvent.Opened(second)).join();
    clock.advance(Duration.ofDays(14));

    var third = filed("where is my starter kit now");
    faq.onEvent(new TicketEvent.Opened(third)).join();

    assertThat(log.recent(10).join().getFirst().note()).isEqualTo("replied starter-kit full");
  }

  @Test
  void shadowRecordsWithoutPosting() {
    var faq = flow(catalog("shadow"));
    var ticket = filed("where is my starter kit");

    faq.onEvent(new TicketEvent.Opened(ticket)).join();

    assertThat(tickets.commentSnapshots(ticket.id()).join()).isEmpty();
    var decisions = log.recent(10).join();
    assertThat(decisions).hasSize(1);
    assertThat(decisions.getFirst().note()).isEqualTo("would-reply starter-kit full");
    assertThat(decisions.getFirst().shadow()).isTrue();
  }

  @Test
  void unknownQuestionsPassThrough() {
    var faq = flow(catalog("active"));
    var ticket = filed("someone broke my wall");

    faq.onEvent(new TicketEvent.Opened(ticket)).join();

    assertThat(tickets.commentSnapshots(ticket.id()).join()).isEmpty();
    assertThat(log.recent(10).join()).isEmpty();
  }

  @Test
  void skipsItsOwnEscalationTickets() {
    var faq = flow(catalog("active"));
    var ticket =
        switch (tickets.openAgentReport("other", "starter kit escalation").join()) {
          case Result.Ok<TicketSnapshot, TicketFailure>(var report) -> report;
          case Result.Err<TicketSnapshot, TicketFailure>(var failure) ->
              throw new AssertionError("agent report failed: " + failure);
        };

    faq.onEvent(new TicketEvent.Opened(ticket)).join();

    assertThat(log.recent(10).join()).isEmpty();
  }

  @Test
  void redrivesDoNotAnswerTwice() {
    var faq = flow(catalog("active"));
    var ticket = filed("where is my starter kit");

    faq.onEvent(new TicketEvent.Opened(ticket)).join();
    faq.onEvent(new TicketEvent.Opened(ticket)).join();

    assertThat(tickets.commentSnapshots(ticket.id()).join()).hasSize(1);
    assertThat(log.recent(10).join()).hasSize(1);
  }

  @Test
  void disabledCatalogAnswersNothing() {
    var faq = flow(AgentFixtures.config("active", List.of()));
    var ticket = filed("where is my starter kit");

    faq.onEvent(new TicketEvent.Opened(ticket)).join();

    assertThat(log.recent(10).join()).isEmpty();
  }

  @Test
  void staffCanForceAnEntry() {
    var faq = flow(catalog("active"));
    var ticket = filed("someone broke my wall");

    var outcome = faq.answer(ticket.id(), Optional.of("server-rules")).join();

    assertThat(outcome).isEqualTo(new FaqFlow.AnswerOutcome.Answered(ticket.id(), "server-rules"));
    assertThat(tickets.commentSnapshots(ticket.id()).join().getFirst().body())
        .contains("Read /rules.");
    assertThat(log.recent(10).join().getFirst().note()).isEqualTo("staff-forced server-rules full");
  }

  @Test
  void staffCanMatchTheCatalog() {
    var faq = flow(catalog("active"));
    var ticket = filed("where is my starter kit");

    var outcome = faq.answer(ticket.id(), Optional.empty()).join();

    assertThat(outcome).isEqualTo(new FaqFlow.AnswerOutcome.Answered(ticket.id(), "starter-kit"));
  }

  @Test
  void staffAnswersReportProblems() {
    var faq = flow(catalog("active"));
    var ticket = filed("someone broke my wall");

    assertThat(faq.answer(404, Optional.empty()).join())
        .isEqualTo(new FaqFlow.AnswerOutcome.Missing(404));
    assertThat(faq.answer(ticket.id(), Optional.of("nope")).join())
        .isEqualTo(new FaqFlow.AnswerOutcome.UnknownEntry("nope"));
    assertThat(faq.answer(ticket.id(), Optional.empty()).join())
        .isEqualTo(new FaqFlow.AnswerOutcome.NoMatch(ticket.id()));
  }
}
