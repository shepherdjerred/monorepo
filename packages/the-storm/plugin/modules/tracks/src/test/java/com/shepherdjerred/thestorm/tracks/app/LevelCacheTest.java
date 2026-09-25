package com.shepherdjerred.thestorm.tracks.app;

import static com.shepherdjerred.thestorm.tracks.app.Track.MECHANIC;
import static com.shepherdjerred.thestorm.tracks.domain.Progressions.owning;
import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;
import org.junit.jupiter.api.Test;

final class LevelCacheTest {

  private static final UUID ALICE = new UUID(0, 1);

  private final LevelCache cache = new LevelCache();

  @Test
  void anUnknownPlayerIsUntrainedAndOffline() {
    assertThat(cache.level(ALICE, MECHANIC)).isZero();
    assertThat(cache.progress(ALICE)).isEmpty();
    assertThat(cache.state(ALICE)).isEmpty();
  }

  @Test
  void aJoinStartsLoadingAndALoadFillsIt() {
    var token = cache.joined(ALICE);
    assertThat(cache.state(ALICE)).contains(new LevelCache.State.Loading());

    cache.loaded(ALICE, token, owning(MECHANIC, 2));

    assertThat(cache.level(ALICE, MECHANIC)).isEqualTo(2);
    assertThat(cache.state(ALICE)).contains(new LevelCache.State.Loaded(owning(MECHANIC, 2)));
  }

  @Test
  void aLoadForAnOfflinePlayerIsIgnored() {
    cache.loaded(ALICE, 1, owning(MECHANIC, 2));

    assertThat(cache.state(ALICE)).isEmpty();
  }

  @Test
  void aLoadFromAnEarlierSessionNeverFillsALaterOne() {
    var first = cache.joined(ALICE);
    cache.quit(ALICE);
    var second = cache.joined(ALICE);

    cache.loaded(ALICE, first, owning(MECHANIC, 2));

    assertThat(cache.state(ALICE)).contains(new LevelCache.State.Loading());
    assertThat(cache.isCurrent(ALICE, first)).isFalse();
    assertThat(cache.isCurrent(ALICE, second)).isTrue();
  }

  @Test
  void aLoadNeverReplacesAChange() {
    var token = cache.joined(ALICE);
    cache.changed(ALICE, owning(MECHANIC, 4));

    cache.loaded(ALICE, token, owning(MECHANIC, 2));

    assertThat(cache.level(ALICE, MECHANIC)).isEqualTo(4);
  }

  @Test
  void aChangeAlwaysReplacesTheProgress() {
    var token = cache.joined(ALICE);
    cache.loaded(ALICE, token, owning(MECHANIC, 2));

    cache.changed(ALICE, owning(MECHANIC, 3));

    assertThat(cache.level(ALICE, MECHANIC)).isEqualTo(3);
  }

  @Test
  void aFailedLoadIsRecordedAndARetryCanStillFillIt() {
    var token = cache.joined(ALICE);

    cache.failed(ALICE, token);
    assertThat(cache.state(ALICE)).contains(new LevelCache.State.Failed());

    cache.loaded(ALICE, token, owning(MECHANIC, 1));
    assertThat(cache.level(ALICE, MECHANIC)).isEqualTo(1);
  }

  @Test
  void aStaleFailureIsIgnored() {
    var first = cache.joined(ALICE);
    var second = cache.joined(ALICE);
    cache.loaded(ALICE, second, owning(MECHANIC, 1));

    cache.failed(ALICE, first);
    cache.failed(ALICE, second);

    assertThat(cache.level(ALICE, MECHANIC)).isEqualTo(1);
  }

  @Test
  void changesForOfflinePlayersAreIgnored() {
    cache.changed(ALICE, owning(MECHANIC, 3));

    assertThat(cache.progress(ALICE)).isEmpty();
  }

  @Test
  void quittingForgetsThePlayer() {
    var token = cache.joined(ALICE);
    cache.loaded(ALICE, token, owning(MECHANIC, 2));

    cache.quit(ALICE);
    cache.changed(ALICE, owning(MECHANIC, 3));

    assertThat(cache.progress(ALICE)).isEmpty();
    assertThat(cache.isCurrent(ALICE, token)).isFalse();
  }
}
