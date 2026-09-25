package com.shepherdjerred.thestorm.tracks.app;

import static com.shepherdjerred.thestorm.tracks.app.Track.ENGINEER;
import static com.shepherdjerred.thestorm.tracks.app.Track.MECHANIC;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.owning;
import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.Test;

final class TrackSessionsTest {

  private static final UUID ALICE = new UUID(0, 1);

  private final TestRuntime test = new TestRuntime();
  private final TrackSessions sessions = new TrackSessions(test.runtime);

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
  }

  @Test
  void aChangeStoredWhileLoadingIsNotOverwritten() {
    test.store.put(ALICE, owning(MECHANIC, 3));
    var gate = new CompletableFuture<Void>();
    test.store.holdLoads(gate);
    sessions.joined(ALICE);

    test.runtime.changed(ALICE, owning(MECHANIC, 3, ENGINEER, 1));
    gate.complete(null);

    assertThat(test.cache.level(ALICE, ENGINEER)).isEqualTo(1);
    assertThat(test.permissions.groupsOf(ALICE))
        .containsExactlyInAnyOrder("storm-mechanic-3", "storm-engineer-1");
  }

  @Test
  void aFailedLoadLeavesThePlayerUnloaded() {
    var gate = new CompletableFuture<Void>();
    test.store.holdLoads(gate);

    sessions.joined(ALICE);
    gate.completeExceptionally(new IllegalStateException("disk full"));

    assertThat(test.cache.progress(ALICE)).isEmpty();
    assertThat(test.permissions.applied()).isZero();
  }
}
