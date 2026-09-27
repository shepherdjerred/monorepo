package com.shepherdjerred.thestorm.agent.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.agent.domain.DecisionAction;
import com.shepherdjerred.thestorm.agent.domain.DecisionDraft;
import com.shepherdjerred.thestorm.agent.domain.Offense;
import com.shepherdjerred.thestorm.core.db.StormDatabase;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class JooqDecisionLogTest {

  private static final UUID ALICE = UUID.fromString("00000000-0000-0000-0000-00000000000a");
  private static final UUID BOB = UUID.fromString("00000000-0000-0000-0000-00000000000b");
  private static final Instant NOW = Instant.parse("2017-06-01T12:00:00Z");

  @TempDir Path directory;

  private StormDatabase database;
  private JooqDecisionLog log;

  @BeforeEach
  void open() {
    database = StormDatabase.open(directory.resolve("a.db"));
    database.migrate("agent", JooqDecisionLogTest.class.getClassLoader());
    log = new JooqDecisionLog(database, "test");
  }

  @AfterEach
  void close() {
    database.close();
  }

  private static DecisionDraft draft(UUID player, DecisionAction action) {
    return draft(player, action, false, false);
  }

  private static DecisionDraft draft(
      UUID player, DecisionAction action, boolean shadow, boolean sampled) {
    return new DecisionDraft(
        player,
        Offense.SPAM,
        Optional.empty(),
        "spam-burst",
        0.9,
        "gpt-5.6-luna",
        action,
        shadow,
        sampled,
        Optional.of(0),
        120L,
        "five identical lines in ten seconds");
  }

  @Test
  void decisionsRoundTrip() throws Exception {
    var recorded = log.record(draft(ALICE, DecisionAction.MUTE), NOW).get(5, TimeUnit.SECONDS);

    assertThat(recorded.id()).isEqualTo(1);
    assertThat(log.find(1).get(5, TimeUnit.SECONDS)).contains(recorded);
    assertThat(log.find(99).get(5, TimeUnit.SECONDS)).isEmpty();
  }

  @Test
  void serversSeeOnlyTheirOwnRows() throws Exception {
    var other = new JooqDecisionLog(database, "other");
    var mine = log.record(draft(ALICE, DecisionAction.MUTE), NOW).get(5, TimeUnit.SECONDS);
    var theirs =
        other
            .record(draft(ALICE, DecisionAction.MUTE), NOW.plusSeconds(1))
            .get(5, TimeUnit.SECONDS);

    assertThat(mine.server()).isEqualTo("test");
    assertThat(theirs.server()).isEqualTo("other");
    assertThat(log.recent(10).get(5, TimeUnit.SECONDS)).containsExactly(mine);
    assertThat(other.recent(10).get(5, TimeUnit.SECONDS)).containsExactly(theirs);
    assertThat(log.find(theirs.id()).get(5, TimeUnit.SECONDS)).isEmpty();
    assertThat(
            log.strikes(ALICE, Offense.SPAM, NOW.minus(Duration.ofDays(7)))
                .get(5, TimeUnit.SECONDS))
        .isEqualTo(1);
    assertThat(log.overturn(theirs.id(), BOB, NOW).get(5, TimeUnit.SECONDS)).isFalse();
    assertThat(log.endorse(theirs.id(), BOB, NOW).get(5, TimeUnit.SECONDS)).isFalse();
  }

  @Test
  void strikesCountEnforcementButNotAllows() throws Exception {
    log.record(draft(ALICE, DecisionAction.MUTE), NOW).get(5, TimeUnit.SECONDS);
    log.record(draft(ALICE, DecisionAction.ALLOW), NOW.plusSeconds(1)).get(5, TimeUnit.SECONDS);
    log.record(draft(ALICE, DecisionAction.WARN), NOW.minus(Duration.ofDays(30)))
        .get(5, TimeUnit.SECONDS);
    log.record(draft(BOB, DecisionAction.MUTE), NOW).get(5, TimeUnit.SECONDS);

    assertThat(
            log.strikes(ALICE, Offense.SPAM, NOW.minus(Duration.ofDays(7)))
                .get(5, TimeUnit.SECONDS))
        .isEqualTo(1);
    assertThat(
            log.strikes(ALICE, Offense.SPAM, NOW.minus(Duration.ofDays(60)))
                .get(5, TimeUnit.SECONDS))
        .isEqualTo(2);
    assertThat(
            log.strikes(ALICE, Offense.GRIEF, NOW.minus(Duration.ofDays(60)))
                .get(5, TimeUnit.SECONDS))
        .isEqualTo(0);
  }

  @Test
  void overturnsMarkTheDecision() throws Exception {
    var recorded = log.record(draft(ALICE, DecisionAction.MUTE), NOW).get(5, TimeUnit.SECONDS);

    assertThat(log.overturn(recorded.id(), BOB, NOW.plusSeconds(60)).get(5, TimeUnit.SECONDS))
        .isTrue();
    assertThat(log.overturn(99, BOB, NOW).get(5, TimeUnit.SECONDS)).isFalse();

    var found = log.find(recorded.id()).get(5, TimeUnit.SECONDS).orElseThrow();
    assertThat(found.overturnedBy()).contains(BOB);
    assertThat(found.overturnedAt()).contains(NOW.plusSeconds(60));
  }

  @Test
  void recentListsNewestFirst() throws Exception {
    var first = log.record(draft(ALICE, DecisionAction.ALLOW), NOW).get(5, TimeUnit.SECONDS);
    var second =
        log.record(draft(BOB, DecisionAction.MUTE), NOW.plusSeconds(1)).get(5, TimeUnit.SECONDS);

    assertThat(log.recent(10).get(5, TimeUnit.SECONDS)).containsExactly(second, first);
    assertThat(log.recent(1).get(5, TimeUnit.SECONDS)).containsExactly(second);
  }

  @Test
  void shadowDecisionsAreKeptButNeverStrike() throws Exception {
    log.record(draft(ALICE, DecisionAction.MUTE, true, false), NOW).get(5, TimeUnit.SECONDS);

    assertThat(log.recent(10).get(5, TimeUnit.SECONDS))
        .extracting(decision -> decision.shadow())
        .containsExactly(true);
    assertThat(
            log.strikes(ALICE, Offense.SPAM, NOW.minus(Duration.ofDays(7)))
                .get(5, TimeUnit.SECONDS))
        .isEqualTo(0);
  }

  @Test
  void recentByFiltersToThePlayer() throws Exception {
    var alice =
        log.record(draft(ALICE, DecisionAction.ALLOW), NOW.plusSeconds(1)).get(5, TimeUnit.SECONDS);
    log.record(draft(BOB, DecisionAction.MUTE), NOW.plusSeconds(2)).get(5, TimeUnit.SECONDS);
    log.record(draft(ALICE, DecisionAction.WARN), NOW).get(5, TimeUnit.SECONDS);

    assertThat(log.recentBy(ALICE, 10).get(5, TimeUnit.SECONDS))
        .extracting(decision -> decision.id())
        .containsExactly(3L, alice.id());
  }

  @Test
  void escalationsListsOnlyEscalationsNewestFirst() throws Exception {
    log.record(draft(ALICE, DecisionAction.ALLOW), NOW).get(5, TimeUnit.SECONDS);
    var first =
        log.record(draft(ALICE, DecisionAction.ESCALATE), NOW.plusSeconds(1))
            .get(5, TimeUnit.SECONDS);
    var second =
        log.record(draft(BOB, DecisionAction.ESCALATE), NOW.plusSeconds(2))
            .get(5, TimeUnit.SECONDS);

    assertThat(log.escalations(10).get(5, TimeUnit.SECONDS)).containsExactly(second, first);
    assertThat(log.escalations(1).get(5, TimeUnit.SECONDS)).containsExactly(second);
  }

  @Test
  void decisionsForTicketListsTheTicketTrailOldestFirst() throws Exception {
    var first = log.record(ticketDraft(7, DecisionAction.ESCALATE), NOW).get(5, TimeUnit.SECONDS);
    log.record(draft(BOB, DecisionAction.MUTE), NOW.plusSeconds(1)).get(5, TimeUnit.SECONDS);
    var second =
        log.record(ticketDraft(7, DecisionAction.ALLOW), NOW.plusSeconds(2))
            .get(5, TimeUnit.SECONDS);
    log.record(ticketDraft(9, DecisionAction.ESCALATE), NOW.plusSeconds(3))
        .get(5, TimeUnit.SECONDS);

    assertThat(log.decisionsForTicket(7).get(5, TimeUnit.SECONDS)).containsExactly(first, second);
    assertThat(log.decisionsForTicket(404).get(5, TimeUnit.SECONDS)).isEmpty();
  }

  @Test
  void endorsementsMarkTheDecision() throws Exception {
    var recorded = log.record(draft(ALICE, DecisionAction.MUTE), NOW).get(5, TimeUnit.SECONDS);

    assertThat(log.endorse(recorded.id(), BOB, NOW.plusSeconds(60)).get(5, TimeUnit.SECONDS))
        .isTrue();
    assertThat(log.endorse(99, BOB, NOW).get(5, TimeUnit.SECONDS)).isFalse();

    var found = log.find(recorded.id()).get(5, TimeUnit.SECONDS).orElseThrow();
    assertThat(found.endorsedBy()).contains(BOB);
    assertThat(found.endorsedAt()).contains(NOW.plusSeconds(60));
  }

  @Test
  void samplesListOnlyUnreviewedNonEscalationsNewestFirst() throws Exception {
    log.record(draft(ALICE, DecisionAction.ALLOW, false, false), NOW).get(5, TimeUnit.SECONDS);
    log.record(draft(ALICE, DecisionAction.ESCALATE, false, true), NOW.plusSeconds(1))
        .get(5, TimeUnit.SECONDS);
    var first =
        log.record(draft(ALICE, DecisionAction.ALLOW, false, true), NOW.plusSeconds(2))
            .get(5, TimeUnit.SECONDS);
    var second =
        log.record(draft(BOB, DecisionAction.MUTE, false, true), NOW.plusSeconds(3))
            .get(5, TimeUnit.SECONDS);

    assertThat(log.samples(10).get(5, TimeUnit.SECONDS)).containsExactly(second, first);
    assertThat(log.samples(1).get(5, TimeUnit.SECONDS)).containsExactly(second);
  }

  @Test
  void reviewedRowsLeaveBothQueues() throws Exception {
    var escalation =
        log.record(draft(ALICE, DecisionAction.ESCALATE), NOW).get(5, TimeUnit.SECONDS);
    var sample =
        log.record(draft(ALICE, DecisionAction.MUTE, false, true), NOW.plusSeconds(1))
            .get(5, TimeUnit.SECONDS);
    var overturnedSample =
        log.record(draft(ALICE, DecisionAction.WARN, false, true), NOW.plusSeconds(2))
            .get(5, TimeUnit.SECONDS);
    log.endorse(escalation.id(), BOB, NOW.plusSeconds(3)).get(5, TimeUnit.SECONDS);
    log.endorse(sample.id(), BOB, NOW.plusSeconds(4)).get(5, TimeUnit.SECONDS);
    log.overturn(overturnedSample.id(), BOB, NOW.plusSeconds(5)).get(5, TimeUnit.SECONDS);

    assertThat(log.escalations(10).get(5, TimeUnit.SECONDS)).isEmpty();
    assertThat(log.samples(10).get(5, TimeUnit.SECONDS)).isEmpty();
  }

  @Test
  void overturnedRowsLeaveTheQueueAndTheStrikeCount() throws Exception {
    var mute = log.record(draft(ALICE, DecisionAction.MUTE), NOW).get(5, TimeUnit.SECONDS);
    var escalation =
        log.record(draft(ALICE, DecisionAction.ESCALATE), NOW.plusSeconds(1))
            .get(5, TimeUnit.SECONDS);
    log.overturn(mute.id(), BOB, NOW.plusSeconds(2)).get(5, TimeUnit.SECONDS);
    log.overturn(escalation.id(), BOB, NOW.plusSeconds(3)).get(5, TimeUnit.SECONDS);

    assertThat(log.escalations(10).get(5, TimeUnit.SECONDS)).isEmpty();
    assertThat(
            log.strikes(ALICE, Offense.SPAM, NOW.minus(Duration.ofDays(7)))
                .get(5, TimeUnit.SECONDS))
        .isEqualTo(0);
  }

  private static DecisionDraft ticketDraft(long ticketId, DecisionAction action) {
    return new DecisionDraft(
        ALICE,
        Offense.OTHER,
        Optional.of(ticketId),
        "triage",
        0.9,
        "gpt-5.6-luna",
        action,
        false,
        false,
        Optional.empty(),
        120L,
        "below-threshold open");
  }
}
