package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.db.StormDatabase;
import com.shepherdjerred.thestorm.rwf.RwfHarness;
import com.shepherdjerred.thestorm.rwf.adapter.db.JooqSnapshotStore;
import com.shepherdjerred.thestorm.rwf.adapter.db.JooqStreakStore;
import com.shepherdjerred.thestorm.rwf.domain.killstreak.Killstreak;
import com.shepherdjerred.thestorm.rwf.domain.killstreak.StreakLoadout;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.bukkit.GameMode;
import org.bukkit.Material;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/** Actual watcher admission with the preference read held behind a scoped database barrier. */
final class WatcherPreferenceAdmissionTest {
  private static final StreakLoadout SELECTED =
      new StreakLoadout(List.of(Killstreak.COMPASS, Killstreak.WOLVES, Killstreak.NAPALM));

  @TempDir Path directory;
  private @Nullable RwfHarness running;

  @AfterEach
  void stop() {
    if (running != null) running.close();
  }

  private RwfHarness start() {
    var harness = RwfHarness.start(directory);
    running = harness;
    return harness;
  }

  private static PlayerMock queueDuringLive(RwfHarness harness) {
    harness.goLive(harness.loadedPlayer("Alice"));
    var bob = harness.loadedPlayer("Bob");
    new JooqStreakStore(harness.database).save(bob.getUniqueId(), SELECTED).join();
    bob.performCommand("rwf join");
    harness.until(() -> bob.getGameMode() == GameMode.SPECTATOR);
    var snapshots = new JooqSnapshotStore(harness.database);
    harness.until(
        () ->
            snapshots.loadAll().join().stream()
                .anyMatch(row -> row.player().equals(bob.getUniqueId())));
    harness.ticks(2);
    RwfHarness.messages(bob);
    return bob;
  }

  private static void openNextLobby(RwfHarness harness, PlayerMock bob) {
    var previous = harness.snapshot().matchId();
    assertThat(((MatchRunner) harness.view()).handle(new MatchEvent.Stop())).isEmpty();
    harness.until(
        () ->
            !harness.snapshot().matchId().equals(previous)
                && harness.snapshot().phase() == MatchSnapshot.PhaseKind.LOBBY);
    assertThat(harness.inMatch(bob)).isFalse();
    assertThat(bob.getGameMode()).isEqualTo(GameMode.SPECTATOR);
    assertThat(RwfHarness.messages(bob))
        .anyMatch(message -> message.contains("Loading your killstreak preferences"));
  }

  @Test
  void queuedWatcherJoinsOncePreferencesCompleteAndKeepsTheirOriginalSnapshot() {
    var harness = start();
    var bob = queueDuringLive(harness);
    var snapshots = new JooqSnapshotStore(harness.database);
    var original =
        snapshots.loadAll().join().stream()
            .filter(row -> row.player().equals(bob.getUniqueId()))
            .findFirst()
            .orElseThrow();
    try (var pause = new DatabasePause(harness.database)) {
      openNextLobby(harness, bob);
      assertThat(pause.pending()).isTrue();
    }
    harness.until(() -> harness.inMatch(bob));
    assertThat(bob.getGameMode()).isEqualTo(GameMode.SURVIVAL);
    assertThat(((MatchRunner) harness.view()).memberOf(bob.getUniqueId()).orElseThrow().streaks())
        .isEqualTo(SELECTED);
    assertThat(snapshots.loadAll().join()).contains(original);
    bob.performCommand("rwf leave");
    assertThat(bob.getInventory().contains(Material.DIAMOND, 5)).isTrue();
    assertThat(bob.getWorld()).isEqualTo(harness.overworld);
    assertThat(bob.getHealth()).isEqualTo(13);
  }

  private enum Cancel {
    LEAVE,
    DISCONNECT
  }

  @ParameterizedTest
  @EnumSource(Cancel.class)
  void aCancelledWatcherRequestCannotBeRevivedByLatePreferences(Cancel cancellation) {
    var harness = start();
    var bob = queueDuringLive(harness);
    CompletableFuture<?> preferences;
    try (var pause = new DatabasePause(harness.database)) {
      openNextLobby(harness, bob);
      preferences = pendingRead(harness, bob.getUniqueId());
      if (cancellation == Cancel.LEAVE) bob.performCommand("rwf leave");
      else bob.disconnect();
      assertThat(pause.pending()).isTrue();
      assertThat(bob.getGameMode()).isEqualTo(GameMode.SURVIVAL);
    }
    // The real database read and main-thread continuation drain without another join command.
    assertThat(preferences.join()).isEqualTo(java.util.Optional.of(SELECTED));
    harness.ticks(20);
    assertThat(harness.inMatch(bob)).isFalse();
    assertThat(bob.getInventory().contains(Material.DIAMOND, 5)).isTrue();
    assertThat(bob.getWorld()).isEqualTo(harness.overworld);
    assertThat(((MatchRunner) harness.view()).memberOf(bob.getUniqueId())).isEmpty();
  }

  /** Observes the actual submitted read, so cancellation assertions run after its completion. */
  private static CompletableFuture<?> pendingRead(RwfHarness harness, UUID player) {
    var picker = ((MatchRunner) harness.view()).streakPicker();
    try {
      var field = StreakPicker.class.getDeclaredField("loading");
      if (field.getType() != Map.class || !field.trySetAccessible())
        throw new IllegalStateException("preference loading field contract changed");
      if (!(field.get(picker) instanceof Map<?, ?> reads)
          || !(reads.get(player) instanceof CompletableFuture<?> future))
        throw new IllegalStateException("expected a pending real preference read");
      return future;
    } catch (ReflectiveOperationException error) {
      throw new IllegalStateException("cannot observe submitted preference read", error);
    }
  }

  private static final class DatabasePause implements AutoCloseable {
    private final CompletableFuture<Void> release = new CompletableFuture<>();
    private final CompletableFuture<Boolean> barrier;

    DatabasePause(StormDatabase database) {
      barrier =
          database.write(
              _ -> {
                release.join();
                return true;
              });
    }

    boolean pending() {
      return !barrier.isDone();
    }

    @Override
    public void close() {
      release.complete(null);
      barrier.join();
    }
  }
}
