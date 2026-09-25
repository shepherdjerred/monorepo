package com.shepherdjerred.thestorm.tracks.app;

import static com.shepherdjerred.thestorm.tracks.app.Track.ENGINEER;
import static com.shepherdjerred.thestorm.tracks.app.Track.MECHANIC;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.NOW;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.boughtAt;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.owning;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.tracks.domain.AdminProblem;
import com.shepherdjerred.thestorm.tracks.domain.TrackProgress;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class TrackAdminTest {

  private static final UUID ALICE = new UUID(0, 1);

  private final TestRuntime test = new TestRuntime();
  private final TrackAdmin admin = new TrackAdmin(test.runtime);

  private void online(TrackProgress progress) {
    test.store.put(ALICE, progress);
    var token = test.cache.joined(ALICE);
    test.cache.loaded(ALICE, token, progress);
  }

  @Test
  void settingALevelStoresCachesAndGrantsIt() {
    online(owning(MECHANIC, 1));

    var result = admin.set(ALICE, MECHANIC, 4).join();

    assertThat(result).isEqualTo(Result.ok(owning(MECHANIC, 4)));
    assertThat(test.store.get(ALICE)).isEqualTo(owning(MECHANIC, 4));
    assertThat(test.cache.level(ALICE, MECHANIC)).isEqualTo(4);
    assertThat(test.permissions.groupsOf(ALICE)).containsExactly("storm-mechanic-4");
  }

  @Test
  void anOfflinePlayerIsStoredAndGrantedButNotCached() {
    var result = admin.set(ALICE, ENGINEER, 2).join();

    assertThat(result).isEqualTo(Result.ok(owning(ENGINEER, 2)));
    assertThat(test.cache.progress(ALICE)).isEmpty();
    assertThat(test.permissions.groupsOf(ALICE)).containsExactly("storm-engineer-2");
  }

  @Test
  void aRefusedChangeWritesAndGrantsNothing() {
    online(owning(MECHANIC, 1));

    var result = admin.set(ALICE, ENGINEER, 2).join();

    assertThat(result)
        .isEqualTo(Result.err(new AdminProblem.AbovePrimary(ENGINEER, 2, MECHANIC, 1)));
    assertThat(test.store.get(ALICE)).isEqualTo(owning(MECHANIC, 1));
    assertThat(test.permissions.applied()).isZero();
  }

  @Test
  void resetClearsEverythingIncludingTheCooldown() {
    online(boughtAt(owning(MECHANIC, 3, ENGINEER, 2), NOW));

    var result = admin.reset(ALICE).join();

    assertThat(result).isEqualTo(TrackProgress.empty());
    assertThat(test.store.get(ALICE)).isEqualTo(TrackProgress.empty());
    assertThat(test.cache.progress(ALICE)).contains(TrackProgress.empty());
    assertThat(test.permissions.groupsOf(ALICE)).isEmpty();
    assertThat(test.permissions.applied()).isEqualTo(1);
  }
}
