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
  void anUnknownPlayerIsUntrained() {
    assertThat(cache.level(ALICE, MECHANIC)).isZero();
    assertThat(cache.progress(ALICE)).isEmpty();
  }

  @Test
  void aLoadFillsTheEntryOnlyForAnOnlinePlayer() {
    cache.loaded(ALICE, owning(MECHANIC, 2));
    assertThat(cache.progress(ALICE)).isEmpty();

    cache.joined(ALICE);
    cache.loaded(ALICE, owning(MECHANIC, 2));
    assertThat(cache.level(ALICE, MECHANIC)).isEqualTo(2);
  }

  @Test
  void aLoadNeverReplacesAnEntry() {
    cache.joined(ALICE);
    cache.changed(ALICE, owning(MECHANIC, 4));

    cache.loaded(ALICE, owning(MECHANIC, 2));

    assertThat(cache.level(ALICE, MECHANIC)).isEqualTo(4);
  }

  @Test
  void aChangeAlwaysReplacesTheEntry() {
    cache.joined(ALICE);
    cache.loaded(ALICE, owning(MECHANIC, 2));

    cache.changed(ALICE, owning(MECHANIC, 3));

    assertThat(cache.level(ALICE, MECHANIC)).isEqualTo(3);
  }

  @Test
  void changesForOfflinePlayersAreIgnored() {
    cache.changed(ALICE, owning(MECHANIC, 3));

    assertThat(cache.progress(ALICE)).isEmpty();
  }

  @Test
  void quittingForgetsThePlayer() {
    cache.joined(ALICE);
    cache.loaded(ALICE, owning(MECHANIC, 2));

    cache.quit(ALICE);
    cache.changed(ALICE, owning(MECHANIC, 3));

    assertThat(cache.progress(ALICE)).isEmpty();
  }
}
