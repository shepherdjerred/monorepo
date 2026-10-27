package com.shepherdjerred.thestorm.mobs.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.Test;

final class BeginnerClockTest {
  private static final UUID PLAYER = UUID.fromString("00000000-0000-0000-0000-000000000001");

  static final class Time implements InstantSource {
    Instant now = Instant.parse("2026-10-16T00:00:00Z");

    @Override
    public Instant instant() {
      return now;
    }

    void advance(Duration duration) {
      now = now.plus(duration);
    }
  }

  static final class Store implements BeginnerTimeStore {
    final Map<UUID, Long> saved = new HashMap<>();

    @Override
    public CompletableFuture<Map<UUID, Long>> load() {
      return CompletableFuture.completedFuture(Map.copyOf(saved));
    }

    @Override
    public CompletableFuture<Void> save(UUID id, long millis) {
      saved.merge(id, millis, Math::max);
      return CompletableFuture.completedFuture(null);
    }

    @Override
    public CompletableFuture<Void> reset(UUID id) {
      saved.remove(id);
      return CompletableFuture.completedFuture(null);
    }
  }

  final Time time = new Time();
  final Store store = new Store();

  BeginnerClock clock() {
    return new BeginnerClock(
        time,
        store,
        failure -> {
          throw new AssertionError(failure);
        },
        (id, millis) -> {});
  }

  @Test
  void freshAllowanceCountsActiveTimeAcrossAfkDisconnectAndRestart() {
    var clock = clock();
    clock.enabled(PLAYER, true, true);
    time.advance(Duration.ofHours(2));
    clock.activity(PLAYER, false);
    time.advance(Duration.ofHours(10));
    assertThat(clock.millis(PLAYER)).isEqualTo(Duration.ofHours(2).toMillis());
    clock.activity(PLAYER, true);
    time.advance(Duration.ofHours(1));
    clock.enabled(PLAYER, false, false);
    time.advance(Duration.ofDays(1));
    clock.close();
    var restarted = clock();
    assertThat(restarted.millis(PLAYER)).isEqualTo(Duration.ofHours(3).toMillis());
    restarted.enabled(PLAYER, true, true);
    time.advance(Duration.ofHours(3));
    assertThat(restarted.millis(PLAYER)).isEqualTo(Duration.ofHours(6).toMillis());
  }

  @Test
  void disabledRolloutPausesAndActivityCannotRestartIt() {
    var clock = clock();
    clock.enabled(PLAYER, false, true);
    time.advance(Duration.ofDays(10));
    assertThat(clock.millis(PLAYER)).isZero();
    assertThat(store.saved).isEmpty();
    clock.enabled(PLAYER, true, true);
    time.advance(Duration.ofMinutes(10));
    clock.enabled(PLAYER, false, false);
    clock.activity(PLAYER, true);
    time.advance(Duration.ofHours(12));
    assertThat(clock.millis(PLAYER)).isEqualTo(Duration.ofMinutes(10).toMillis());
    clock.enabled(PLAYER, true, true);
    time.advance(Duration.ofMinutes(10));
    assertThat(clock.millis(PLAYER)).isEqualTo(Duration.ofMinutes(20).toMillis());
  }

  @Test
  void checkpointsAndBackwardClockAreObserved() {
    var clock = clock();
    clock.enabled(PLAYER, true, true);
    time.advance(Duration.ofMinutes(1));
    clock.activity(PLAYER, true);
    assertThat(store.saved.get(PLAYER)).isEqualTo(60_000);
    time.advance(Duration.ofMinutes(-1));
    assertThatThrownBy(() -> clock.millis(PLAYER)).isInstanceOf(IllegalStateException.class);
  }

  @Test
  void loadFailureNeverBecomesFreshProtection() {
    var failure = new IllegalStateException("storage unavailable");
    var observed = new java.util.ArrayList<Throwable>();
    BeginnerTimeStore broken =
        new BeginnerTimeStore() {
          @Override
          public CompletableFuture<Map<UUID, Long>> load() {
            return CompletableFuture.failedFuture(failure);
          }

          @Override
          public CompletableFuture<Void> save(UUID id, long millis) {
            throw new AssertionError("must not save");
          }

          @Override
          public CompletableFuture<Void> reset(UUID id) {
            throw new AssertionError("must not reset");
          }
        };
    var clock = new BeginnerClock(time, broken, observed::add, (id, millis) -> {});
    assertThat(clock.ready()).isCompletedExceptionally();
    assertThat(observed).hasSize(1);
    assertThatThrownBy(() -> clock.enabled(PLAYER, true, true))
        .isInstanceOf(IllegalStateException.class);
  }
}
