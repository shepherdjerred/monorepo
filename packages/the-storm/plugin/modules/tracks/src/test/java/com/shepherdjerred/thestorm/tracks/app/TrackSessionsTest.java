package com.shepherdjerred.thestorm.tracks.app;

import static com.shepherdjerred.thestorm.tracks.app.Track.ENGINEER;
import static com.shepherdjerred.thestorm.tracks.app.Track.MECHANIC;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.owning;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

final class TrackSessionsTest {

  private static final UUID ALICE = new UUID(0, 1);

  private final TestRuntime test = new TestRuntime();
  private final List<UUID> toldLoadFailed = new ArrayList<>();
  private final TrackSessions sessions = new TrackSessions(test.runtime, toldLoadFailed::add);

  @Test
  void joiningLoadsTheStoredLevelsAndReconcilesPermissions() {
    test.store.put(ALICE, owning(MECHANIC, 3));

    sessions.joined(ALICE);

    assertThat(test.cache.level(ALICE, MECHANIC)).isEqualTo(3);
    assertThat(test.permissions.groupsOf(ALICE)).containsExactly("storm-mechanic-3");
  }

  @Test
  void levelsReadZeroUntilTheyLoad() {
    test.store.put(ALICE, owning(MECHANIC, 3));
    var gate = new CompletableFuture<Void>();
    test.store.holdLoads(gate);

    sessions.joined(ALICE);
    var before = test.cache.level(ALICE, MECHANIC);
    gate.complete(null);

    assertThat(before).isZero();
    assertThat(test.cache.level(ALICE, MECHANIC)).isEqualTo(3);
  }

  @Test
  void quittingDropsTheLevels() {
    test.store.put(ALICE, owning(MECHANIC, 3));
    sessions.joined(ALICE);

    sessions.quit(ALICE);

    assertThat(test.cache.progress(ALICE)).isEmpty();
    assertThat(test.cache.level(ALICE, MECHANIC)).isZero();
  }

  @Test
  void aLoadThatFinishesAfterQuittingIsIgnored() {
    test.store.put(ALICE, owning(MECHANIC, 3));
    var gate = new CompletableFuture<Void>();
    test.store.holdLoads(gate);

    sessions.joined(ALICE);
    sessions.quit(ALICE);
    gate.complete(null);

    assertThat(test.cache.progress(ALICE)).isEmpty();
    assertThat(test.permissions.applied()).isZero();
  }

  @Test
  void aSlowLoadFromAnEarlierJoinDoesNotFillARejoin() {
    test.store.put(ALICE, owning(MECHANIC, 3));
    var slow = new CompletableFuture<Void>();
    test.store.holdLoads(slow);
    sessions.joined(ALICE);
    sessions.quit(ALICE);
    var rejoinGate = new CompletableFuture<Void>();
    test.store.holdLoads(rejoinGate);
    sessions.joined(ALICE);

    slow.complete(null);

    assertThat(test.cache.state(ALICE)).contains(new LevelCache.State.Loading());
    rejoinGate.complete(null);
    assertThat(test.cache.level(ALICE, MECHANIC)).isEqualTo(3);
  }

  @Test
  void aChangeStoredWhileLoadingIsNotOverwritten() {
    test.store.put(ALICE, owning(MECHANIC, 3));
    var gate = new CompletableFuture<Void>();
    test.store.holdLoads(gate);
    sessions.joined(ALICE);

    test.store.put(ALICE, owning(MECHANIC, 3, ENGINEER, 1));
    test.runtime.changed(ALICE, owning(MECHANIC, 3, ENGINEER, 1));
    gate.complete(null);

    assertThat(test.cache.level(ALICE, ENGINEER)).isEqualTo(1);
    assertThat(test.permissions.groupsOf(ALICE))
        .containsExactlyInAnyOrder("storm-mechanic-3", "storm-engineer-1");
  }

  @Test
  void aFailedLoadTellsThePlayerOnceAndRetriesWithGrowingDelays() {
    test.store.put(ALICE, owning(MECHANIC, 2));
    test.store.failLoads(3);

    sessions.joined(ALICE);

    assertThat(test.cache.state(ALICE)).contains(new LevelCache.State.Failed());
    assertThat(toldLoadFailed).containsExactly(ALICE);
    assertThat(test.scheduler.pendingDelays()).containsExactly(Duration.ofSeconds(1));

    test.scheduler.runDelayed();
    assertThat(test.scheduler.pendingDelays()).containsExactly(Duration.ofSeconds(2));
    test.scheduler.runDelayed();
    assertThat(test.scheduler.pendingDelays()).containsExactly(Duration.ofSeconds(4));
    test.scheduler.runDelayed();

    assertThat(test.cache.level(ALICE, MECHANIC)).isEqualTo(2);
    assertThat(test.scheduler.pendingDelays()).isEmpty();
    assertThat(toldLoadFailed).containsExactly(ALICE);
    assertThat(test.permissions.groupsOf(ALICE)).containsExactly("storm-mechanic-2");
  }

  @Test
  void retriesStopWhenThePlayerLeaves() {
    test.store.failLoads(1);
    sessions.joined(ALICE);
    sessions.quit(ALICE);

    test.scheduler.runDelayed();

    assertThat(test.store.loads()).isEqualTo(1);
    assertThat(test.cache.state(ALICE)).isEmpty();
  }

  @ParameterizedTest(name = "retry {0} waits {1}s")
  @CsvSource({"1, 1", "2, 2", "3, 4", "4, 8", "5, 16", "6, 32", "7, 60", "8, 60", "100, 60"})
  void retryDelaysDoubleUpToAMinute(int attempt, long seconds) {
    assertThat(TrackSessions.retryDelay(attempt)).isEqualTo(Duration.ofSeconds(seconds));
  }

  @Test
  void retriesCountFromOne() {
    assertThatThrownBy(() -> TrackSessions.retryDelay(0))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
