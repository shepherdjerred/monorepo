package com.shepherdjerred.thestorm.agent.app;

import static com.shepherdjerred.thestorm.agent.app.AgentFixtures.ALICE;
import static com.shepherdjerred.thestorm.agent.app.AgentFixtures.NOW;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.agent.adapter.db.JooqDecisionLog;
import com.shepherdjerred.thestorm.agent.adapter.stub.StubBrainClient;
import com.shepherdjerred.thestorm.agent.app.AgentFixtures.Clock;
import com.shepherdjerred.thestorm.agent.app.AgentFixtures.MemoryChatStore;
import com.shepherdjerred.thestorm.agent.app.AgentFixtures.RecordingContact;
import com.shepherdjerred.thestorm.agent.domain.DecisionAction;
import com.shepherdjerred.thestorm.chat.app.ChatAuthor;
import com.shepherdjerred.thestorm.chat.app.ChatLine;
import com.shepherdjerred.thestorm.chat.app.ChatService;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.tickets.adapter.db.JooqTicketStore;
import com.shepherdjerred.thestorm.tickets.app.TicketService;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Random;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class ChatFlowTest {

  @TempDir Path directory;

  private final Clock clock = new Clock();
  private final MemoryChatStore chatStore = new MemoryChatStore();
  private final RecordingContact contact = new RecordingContact();
  private final RecentChat recents = new RecentChat();
  private final List<ClassifyCase> brainCalls = new ArrayList<>();

  private StormDatabase database;
  private ChatService chat;
  private JooqDecisionLog log;
  private TicketService tickets;

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("storm.db"));
    database.migrate("agent", ChatFlowTest.class.getClassLoader());
    database.migrate("tickets", ChatFlowTest.class.getClassLoader());
    chat = AgentFixtures.chatService(chatStore, clock);
    log = new JooqDecisionLog(database, "test");
    tickets = new TicketService(new JooqTicketStore(database, "test"), clock);
  }

  @AfterEach
  void close() {
    database.close();
  }

  private ChatFlow flow(BrainClient brain, AgentConfig config) {
    return new ChatFlow(
        recents,
        chat,
        contact,
        new AgentServices(brain, log, tickets, clock, config, new Random(1)));
  }

  private BrainClient brain(ClassifyVerdict verdict) {
    return new StubBrainClient(
        kase -> {
          brainCalls.add(kase);
          return verdict;
        },
        kase -> {
          throw new AssertionError("chat never triages");
        });
  }

  private BrainClient disabledBrain() {
    return new BrainClient() {
      @Override
      public CompletableFuture<ClassifyVerdict> classify(ClassifyCase kase) {
        brainCalls.add(kase);
        return CompletableFuture.failedFuture(new BrainDisabledException("classify"));
      }

      @Override
      public CompletableFuture<TriageProposal> triage(TriageCase kase) {
        throw new AssertionError("chat never triages");
      }
    };
  }

  private ChatLine chat(String text) {
    return new ChatLine(clock.instant(), new ChatAuthor.InGame(ALICE, "Alice"), text);
  }

  private AgentConfig spamLadder(String mode) {
    return spamLadder(mode, 10);
  }

  private AgentConfig spamLadder(String mode, int reviewSamplePercent) {
    return AgentFixtures.config(
        mode,
        List.of(
            AgentFixtures.ladder(
                "spam",
                new AgentConfig.StepFile("mute", "10m"),
                new AgentConfig.StepFile("mute", "1h"),
                new AgentConfig.StepFile("tempban", "1d"))),
        reviewSamplePercent);
  }

  private ClassifyVerdict verdict(Optional<String> offense, double confidence) {
    return new ClassifyVerdict(offense, confidence, "brain-call", "the brain spoke", "stub", 0);
  }

  @Test
  void cleanChatPassesUnrecorded() {
    var chatFlow = flow(brain(verdict(Optional.of("spam"), 1)), spamLadder("active"));

    chatFlow.onChatLine(chat("hello everyone")).join();

    assertThat(log.recent(10).join()).isEmpty();
    assertThat(brainCalls).isEmpty();
  }

  @Test
  void rateBurstsMuteWithoutTheBrain() {
    var chatFlow = flow(brain(verdict(Optional.of("spam"), 1)), spamLadder("active"));

    for (var i = 1; i <= 6; i++) {
      chatFlow.onChatLine(chat("message " + i)).join();
    }

    assertThat(brainCalls).isEmpty();
    var mute = chat.activeMute(ALICE).orElseThrow();
    assertThat(mute.until()).isEqualTo(NOW.plus(Duration.ofMinutes(10)));
    assertThat(mute.reason()).isEqualTo("prefilter/rate");
    var decisions = log.recent(10).join();
    assertThat(decisions).hasSize(1);
    var decision = decisions.getFirst();
    assertThat(decision.action()).isEqualTo(DecisionAction.MUTE);
    assertThat(decision.ladderStep()).contains(0);
    assertThat(decision.shadow()).isFalse();
    assertThat(decision.model()).isEqualTo("prefilter");
  }

  @Test
  void fullSamplingQueuesDecisionsForReview() {
    var chatFlow = flow(brain(verdict(Optional.of("spam"), 1)), spamLadder("shadow", 100));

    for (var i = 1; i <= 6; i++) {
      chatFlow.onChatLine(chat("message " + i)).join();
    }

    var decisions = log.recent(10).join();
    assertThat(decisions).hasSize(1);
    assertThat(decisions.getFirst().sampled()).isTrue();
    assertThat(log.samples(10).join()).containsExactly(decisions.getFirst());
  }

  @Test
  void zeroSamplingQueuesNothing() {
    var chatFlow = flow(brain(verdict(Optional.of("spam"), 1)), spamLadder("shadow", 0));

    for (var i = 1; i <= 6; i++) {
      chatFlow.onChatLine(chat("message " + i)).join();
    }

    var decisions = log.recent(10).join();
    assertThat(decisions).hasSize(1);
    assertThat(decisions.getFirst().sampled()).isFalse();
    assertThat(log.samples(10).join()).isEmpty();
  }

  @Test
  void shadowRecordsButDoesNotMute() {
    var chatFlow = flow(brain(verdict(Optional.of("spam"), 1)), spamLadder("shadow"));

    for (var i = 1; i <= 6; i++) {
      chatFlow.onChatLine(chat("message " + i)).join();
    }

    assertThat(chat.activeMute(ALICE)).isEmpty();
    var decisions = log.recent(10).join();
    assertThat(decisions).hasSize(1);
    assertThat(decisions.getFirst().action()).isEqualTo(DecisionAction.MUTE);
    assertThat(decisions.getFirst().shadow()).isTrue();
  }

  @Test
  void capsAsksTheBrainThenWarns() {
    var config =
        AgentFixtures.config(
            "active",
            List.of(AgentFixtures.ladder("toxicity", new AgentConfig.StepFile("warn", "none"))));
    var chatFlow = flow(brain(verdict(Optional.of("toxicity"), 0.9)), config);

    chatFlow.onChatLine(chat("THIS IS ALL CAPS AND LONG ENOUGH")).join();

    assertThat(brainCalls).hasSize(1);
    assertThat(brainCalls.getFirst().lines())
        .extracting(line -> line.text())
        .contains("THIS IS ALL CAPS AND LONG ENOUGH");
    var decisions = log.recent(10).join();
    assertThat(decisions).hasSize(1);
    assertThat(decisions.getFirst().action()).isEqualTo(DecisionAction.WARN);
    assertThat(contact.tells).hasSize(1);
    assertThat(contact.tells.getFirst()).contains("please stop that language");
  }

  @Test
  void cleanAndUncertainVerdictsAllow() {
    var chatFlow = flow(brain(verdict(Optional.empty(), 0)), spamLadder("active"));
    chatFlow.onChatLine(chat("THIS IS ALL CAPS AND LONG ENOUGH")).join();

    var uncertain = flow(brain(verdict(Optional.of("spam"), 0.5)), spamLadder("active"));
    uncertain.onChatLine(chat("ANOTHER CAPS LINE THAT IS LONG")).join();

    var decisions = log.recent(10).join();
    assertThat(decisions)
        .extracting(decision -> decision.action())
        .containsExactly(DecisionAction.ALLOW, DecisionAction.ALLOW);
    assertThat(chat.activeMute(ALICE)).isEmpty();
    assertThat(contact.tells).isEmpty();
  }

  @Test
  void disabledBrainPassesLinesUnjudged() {
    var chatFlow = flow(disabledBrain(), spamLadder("active"));

    chatFlow.onChatLine(chat("THIS IS ALL CAPS AND LONG ENOUGH")).join();

    assertThat(brainCalls).hasSize(1);
    assertThat(log.recent(10).join()).isEmpty();
    assertThat(contact.tells).isEmpty();
    assertThat(chat.activeMute(ALICE)).isEmpty();
  }

  @Test
  void unknownOffensesFailLoudly() {
    var chatFlow = flow(brain(verdict(Optional.of("littering"), 0.99)), spamLadder("active"));

    assertThatThrownBy(() -> chatFlow.onChatLine(chat("THIS IS ALL CAPS AND LONG ENOUGH")).join())
        .isInstanceOf(CompletionException.class)
        .cause()
        .isInstanceOf(BrainException.class)
        .hasMessageContaining("unknown offense id: littering");

    assertThat(log.recent(10).join()).isEmpty();
    assertThat(chat.activeMute(ALICE)).isEmpty();
  }

  @Test
  void sustainedBurstsClimbThenEscalate() {
    var chatFlow = flow(brain(verdict(Optional.of("spam"), 1)), spamLadder("active"));

    for (var i = 1; i <= 8; i++) {
      chatFlow.onChatLine(chat("message " + i)).join();
    }

    var decisions = log.recent(10).join();
    assertThat(decisions)
        .extracting(decision -> decision.action())
        .containsExactly(DecisionAction.ESCALATE, DecisionAction.MUTE, DecisionAction.MUTE);
    assertThat(decisions)
        .extracting(decision -> decision.ladderStep())
        .containsExactly(Optional.of(2), Optional.of(1), Optional.of(0));
    assertThat(chat.activeMute(ALICE).orElseThrow().until())
        .isEqualTo(NOW.plus(Duration.ofHours(1)));

    var escalation = tickets.snapshot(1).join().orElseThrow();
    assertThat(escalation.categoryId()).isEqualTo("chat");
    assertThat(escalation.reporter()).isEqualTo(TicketService.SYSTEM_REPORTER);
    assertThat(escalation.summary()).contains("spam");
    assertThat(tickets.commentSnapshots(1).join()).hasSize(1);
    assertThat(tickets.commentSnapshots(1).join().getFirst().body()).contains("Decision #3");
  }

  @Test
  void kickRungsKick() {
    var config =
        AgentFixtures.config(
            "active",
            List.of(AgentFixtures.ladder("spam", new AgentConfig.StepFile("kick", "none"))));
    var chatFlow = flow(brain(verdict(Optional.of("spam"), 1)), config);

    for (var i = 1; i <= 6; i++) {
      chatFlow.onChatLine(chat("message " + i)).join();
    }

    assertThat(log.recent(10).join().getFirst().action()).isEqualTo(DecisionAction.KICK);
    assertThat(contact.kicks).hasSize(1);
    assertThat(chat.activeMute(ALICE)).isEmpty();
  }

  @Test
  void missingLaddersEscalate() {
    var chatFlow =
        flow(brain(verdict(Optional.of("spam"), 1)), AgentFixtures.config("active", List.of()));

    for (var i = 1; i <= 6; i++) {
      chatFlow.onChatLine(chat("message " + i)).join();
    }

    var decisions = log.recent(10).join();
    assertThat(decisions).hasSize(1);
    assertThat(decisions.getFirst().action()).isEqualTo(DecisionAction.ESCALATE);
    assertThat(tickets.snapshot(1).join()).isPresent();
  }

  @Test
  void relayedLinesOnlyFeedTheRing() {
    var chatFlow = flow(brain(verdict(Optional.of("spam"), 1)), spamLadder("active"));

    chatFlow
        .onChatLine(new ChatLine(clock.instant(), new ChatAuthor.External("D", "Dee"), "hi"))
        .join();

    assertThat(log.recent(10).join()).isEmpty();
    assertThat(recents.last(10)).hasSize(1);
  }
}
