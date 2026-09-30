package com.shepherdjerred.thestorm.agent.app;

import static com.shepherdjerred.thestorm.agent.app.AgentFixtures.ALICE;
import static com.shepherdjerred.thestorm.agent.app.AgentFixtures.NOW;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.agent.adapter.db.JooqDecisionLog;
import com.shepherdjerred.thestorm.agent.adapter.stub.StubBrainClient;
import com.shepherdjerred.thestorm.agent.app.AgentFixtures.Clock;
import com.shepherdjerred.thestorm.agent.app.AgentFixtures.MemoryModLog;
import com.shepherdjerred.thestorm.agent.domain.DecisionAction;
import com.shepherdjerred.thestorm.chat.app.ChatAuthor;
import com.shepherdjerred.thestorm.chat.app.ChatLine;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.essentials.app.ModerationService;
import com.shepherdjerred.thestorm.essentials.domain.moderation.Actor;
import com.shepherdjerred.thestorm.essentials.domain.moderation.AuditEntry;
import com.shepherdjerred.thestorm.essentials.domain.moderation.ModerationAction;
import com.shepherdjerred.thestorm.tickets.adapter.db.JooqTicketStore;
import com.shepherdjerred.thestorm.tickets.app.TicketEvent;
import com.shepherdjerred.thestorm.tickets.app.TicketFailure;
import com.shepherdjerred.thestorm.tickets.app.TicketService;
import com.shepherdjerred.thestorm.tickets.app.TicketSnapshot;
import com.shepherdjerred.thestorm.tickets.app.TicketSnapshots;
import com.shepherdjerred.thestorm.tickets.domain.TicketCategory;
import com.shepherdjerred.thestorm.tickets.domain.TicketDraft;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
import java.util.Random;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class TriageFlowTest {

  @TempDir Path directory;

  private final Clock clock = new Clock();
  private final MemoryModLog modLog = new MemoryModLog();
  private final RecentChat recents = new RecentChat();

  private StormDatabase database;
  private JooqDecisionLog log;
  private TicketService tickets;
  private ModerationService moderation;

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("storm.db"));
    database.migrate("agent", TriageFlowTest.class.getClassLoader());
    database.migrate("tickets", TriageFlowTest.class.getClassLoader());
    log = new JooqDecisionLog(database, "test");
    tickets = new TicketService(new JooqTicketStore(database, "test"), clock);
    moderation = ModerationService.load(modLog, clock);
  }

  @AfterEach
  void close() {
    database.close();
  }

  private TriageFlow flow(BrainClient brain, AgentConfig config) {
    return new TriageFlow(
        recents,
        Optional.of(moderation),
        new AgentServices(brain, log, tickets, clock, config, new Random(1)));
  }

  private TriageFlow flowWithoutModeration(BrainClient brain, AgentConfig config) {
    return new TriageFlow(
        recents,
        Optional.empty(),
        new AgentServices(brain, log, tickets, clock, config, new Random(1)));
  }

  private BrainClient brain(TriageProposal proposal) {
    return brain(proposal, new AtomicReference<>());
  }

  private BrainClient brain(TriageProposal proposal, AtomicReference<TriageCase> seen) {
    return new StubBrainClient(
        kase -> {
          throw new AssertionError("triage never classifies");
        },
        kase -> {
          seen.set(kase);
          return proposal;
        });
  }

  private BrainClient disabledBrain(AtomicReference<TriageCase> seen) {
    return new BrainClient() {
      @Override
      public CompletableFuture<ClassifyVerdict> classify(ClassifyCase kase) {
        throw new AssertionError("triage never classifies");
      }

      @Override
      public CompletableFuture<TriageProposal> triage(TriageCase kase) {
        seen.set(kase);
        return CompletableFuture.failedFuture(new BrainDisabledException("triage"));
      }
    };
  }

  private AgentConfig config(String mode) {
    return AgentFixtures.config(mode, List.of());
  }

  private TicketSnapshot filed() {
    var ticket =
        tickets
            .open(new TicketDraft(ALICE, TicketCategory.GRIEF, "my wall is gone", Optional.empty()))
            .join();
    return TicketSnapshots.from(ticket);
  }

  private static TriageProposal proposal(
      String priority, double confidence, boolean resolve, String note) {
    return new TriageProposal(
        priority,
        confidence,
        List.of(),
        "blocks are missing",
        "looking into it",
        resolve,
        note,
        "stub",
        0);
  }

  private TicketSnapshot agentFiled() {
    return switch (tickets.openAgentReport("chat", "escalation").join()) {
      case Result.Ok<TicketSnapshot, TicketFailure>(var ticket) -> ticket;
      case Result.Err<TicketSnapshot, TicketFailure>(var failure) ->
          throw new AssertionError("agent report failed: " + failure);
    };
  }

  @Test
  void skipsItsOwnEscalationTickets() {
    var flow = flow(brain(proposal("urgent", 0.9, false, "")), config("active"));
    var ticket = agentFiled();

    flow.onEvent(new TicketEvent.Opened(ticket)).join();

    assertThat(log.recent(10).join()).isEmpty();
  }

  @Test
  void confidentTriageAttachesAndQueuesForHumans() {
    var flow = flow(brain(proposal("urgent", 0.9, false, "")), config("active"));

    var ticket = filed();
    flow.onEvent(new TicketEvent.Opened(ticket)).join();

    var worked = tickets.snapshot(ticket.id()).join().orElseThrow();
    assertThat(worked.priorityId()).isEqualTo("urgent");
    assertThat(worked.triage().orElseThrow().evidence()).isEqualTo("blocks are missing");
    var decisions = log.recent(10).join();
    assertThat(decisions).hasSize(1);
    assertThat(decisions.getFirst().action()).isEqualTo(DecisionAction.ESCALATE);
    assertThat(decisions.getFirst().ticketId()).contains(ticket.id());
    assertThat(decisions.getFirst().shadow()).isFalse();
  }

  @Test
  void convincingResolutionsClose() {
    var flow = flow(brain(proposal("normal", 0.97, true, "rebuilt your wall")), config("active"));

    var ticket = filed();
    flow.onEvent(new TicketEvent.Opened(ticket)).join();

    var worked = tickets.snapshot(ticket.id()).join().orElseThrow();
    assertThat(worked.statusId()).isEqualTo("resolved");
    assertThat(tickets.commentSnapshots(ticket.id()).join())
        .extracting(comment -> comment.body())
        .containsExactly("rebuilt your wall");
    assertThat(log.recent(10).join().getFirst().action()).isEqualTo(DecisionAction.ALLOW);
  }

  @Test
  void resolutionsJoinTheSpotCheckQueueWhenSampled() {
    var sampled = AgentFixtures.config("active", List.of(), 100);
    var flow = flow(brain(proposal("normal", 0.97, true, "rebuilt your wall")), sampled);

    var ticket = filed();
    flow.onEvent(new TicketEvent.Opened(ticket)).join();

    var decisions = log.recent(10).join();
    assertThat(decisions).hasSize(1);
    assertThat(decisions.getFirst().action()).isEqualTo(DecisionAction.ALLOW);
    assertThat(decisions.getFirst().sampled()).isTrue();
    assertThat(log.samples(10).join()).containsExactly(decisions.getFirst());
  }

  @Test
  void lowConfidenceStaysQueued() {
    var flow = flow(brain(proposal("urgent", 0.1, false, "")), config("active"));

    var ticket = filed();
    flow.onEvent(new TicketEvent.Opened(ticket)).join();

    var worked = tickets.snapshot(ticket.id()).join().orElseThrow();
    assertThat(worked.triage()).isEmpty();
    assertThat(worked.statusId()).isEqualTo("open");
    assertThat(log.recent(10).join().getFirst().action()).isEqualTo(DecisionAction.ESCALATE);
  }

  @Test
  void disabledBrainLeavesTicketsUnworked() {
    var seen = new AtomicReference<TriageCase>();
    var flow = flow(disabledBrain(seen), config("active"));

    var ticket = filed();
    flow.onEvent(new TicketEvent.Opened(ticket)).join();

    assertThat(seen.get()).isNotNull();
    var worked = tickets.snapshot(ticket.id()).join().orElseThrow();
    assertThat(worked.triage()).isEmpty();
    assertThat(worked.statusId()).isEqualTo("open");
    assertThat(log.recent(10).join()).isEmpty();
  }

  @Test
  void shadowWritesNothing() {
    var flow = flow(brain(proposal("urgent", 0.97, true, "rebuilt")), config("shadow"));

    var ticket = filed();
    flow.onEvent(new TicketEvent.Opened(ticket)).join();

    var worked = tickets.snapshot(ticket.id()).join().orElseThrow();
    assertThat(worked.triage()).isEmpty();
    assertThat(worked.statusId()).isEqualTo("open");
    var decisions = log.recent(10).join();
    assertThat(decisions).hasSize(1);
    assertThat(decisions.getFirst().shadow()).isTrue();
    assertThat(decisions.getFirst().action()).isEqualTo(DecisionAction.ALLOW);
    assertThat(decisions.getFirst().note()).contains("would-resolve");
  }

  @Test
  void badPrioritiesAreRejected() {
    var flow = flow(brain(proposal("extreme", 0.9, false, "")), config("active"));

    var ticket = filed();
    flow.onEvent(new TicketEvent.Opened(ticket)).join();

    assertThat(tickets.snapshot(ticket.id()).join().orElseThrow().triage()).isEmpty();
    var decisions = log.recent(10).join();
    assertThat(decisions).hasSize(1);
    assertThat(decisions.getFirst().action()).isEqualTo(DecisionAction.ESCALATE);
    assertThat(decisions.getFirst().note()).contains("rejected");
  }

  @Test
  void theBrainSeesHistoryAndRecentChat() {
    modLog.entries.add(
        AuditEntry.of(
            ALICE,
            ModerationAction.KICK,
            Actor.CONSOLE,
            AuditEntry.Term.permanent("griefing", NOW)));
    recents.record(new ChatLine(NOW, new ChatAuthor.InGame(ALICE, "Alice"), "my wall is gone"));
    var seen = new AtomicReference<TriageCase>();
    var flow = flow(brain(proposal("urgent", 0.9, false, ""), seen), config("active"));

    var ticket = filed();
    flow.onEvent(new TicketEvent.Opened(ticket)).join();

    var kase = seen.get();
    assertThat(kase.ticket().id()).isEqualTo(ticket.id());
    assertThat(kase.reporterHistory())
        .extracting(record -> record.actionId())
        .containsExactly("kick");
    assertThat(kase.reporterBanned()).isFalse();
    assertThat(kase.reporterRecentChat())
        .extracting(sample -> sample.text())
        .containsExactly("my wall is gone");
  }

  @Test
  void withoutEssentialsHistoryIsEmptyAndReportersCountAsUnbanned() {
    var seen = new AtomicReference<TriageCase>();
    var flow =
        flowWithoutModeration(brain(proposal("urgent", 0.9, false, ""), seen), config("active"));

    var ticket = filed();
    flow.onEvent(new TicketEvent.Opened(ticket)).join();

    var kase = seen.get();
    assertThat(kase.reporterHistory()).isEmpty();
    assertThat(kase.reporterBanned()).isFalse();
    assertThat(tickets.snapshot(ticket.id()).join().orElseThrow().triage()).isPresent();
  }

  @Test
  void ignoresNonOpenings() {
    var flow = flow(brain(proposal("urgent", 0.9, false, "")), config("active"));

    flow.onEvent(new TicketEvent.Resolved(filed())).join();

    assertThat(log.recent(10).join()).isEmpty();
  }
}
