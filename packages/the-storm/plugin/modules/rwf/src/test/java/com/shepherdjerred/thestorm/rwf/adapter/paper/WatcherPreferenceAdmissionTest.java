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
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.bukkit.GameMode;
import org.bukkit.Material;
import org.jooq.Configuration;
import org.jooq.DSLContext;
import org.jooq.ExecuteListener;
import org.jooq.ExecuteListenerProvider;
import org.jooq.ExecuteType;
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

  private static PlayerMock prepareOrdinaryJoin(RwfHarness harness) {
    harness.enter(harness.loadedPlayer("Alice"));
    var bob = harness.loadedPlayer("Bob");
    new JooqStreakStore(harness.database).save(bob.getUniqueId(), SELECTED).join();
    return bob;
  }

  private static CompletableFuture<?> queuePendingOrdinaryJoin(
      RwfHarness harness, PlayerMock bob, PreferenceReadPause pause) {
    bob.performCommand("rwf join");
    harness.until(pause::entered);
    var future = pendingRead(harness, bob.getUniqueId());
    var alice = harness.server.getPlayer("Alice");
    if (!(alice instanceof PlayerMock player)) throw new IllegalStateException("Alice is absent");
    harness.goLive(player);
    bob.performCommand("rwf join");
    harness.until(() -> bob.getGameMode() == GameMode.SPECTATOR);
    var snapshots = new JooqSnapshotStore(harness.database);
    harness.until(
        () ->
            snapshots.loadAll().join().stream()
                .anyMatch(row -> row.player().equals(bob.getUniqueId())));
    harness.ticks(2);
    RwfHarness.messages(bob);
    return future;
  }

  @Test
  void anEarlierOrdinaryReadResumesTheCurrentQueuedWatcherAdmission() {
    var harness = start();
    var bob = prepareOrdinaryJoin(harness);
    CompletableFuture<?> preferences;
    try (var pause = new PreferenceReadPause(harness.database)) {
      preferences = queuePendingOrdinaryJoin(harness, bob, pause);
      openNextLobby(harness, bob);
      assertThat(pendingRead(harness, bob.getUniqueId())).isSameAs(preferences);
    }
    assertThat(preferences.join()).isEqualTo(Optional.of(SELECTED));
    harness.until(() -> harness.inMatch(bob));
    assertThat(((MatchRunner) harness.view()).memberOf(bob.getUniqueId()).orElseThrow().streaks())
        .isEqualTo(SELECTED);
    bob.performCommand("rwf leave");
    assertThat(bob.getInventory().contains(Material.DIAMOND, 5)).isTrue();
    assertThat(bob.getWorld()).isEqualTo(harness.overworld);
    assertThat(bob.getHealth()).isEqualTo(13);
  }

  @Test
  void watchingSuspendsAnEarlierOrdinaryRetryWithoutRecoveringItsSnapshot() {
    var harness = start();
    var bob = prepareOrdinaryJoin(harness);
    var snapshots = new JooqSnapshotStore(harness.database);
    CompletableFuture<?> preferences;
    try (var pause = new PreferenceReadPause(harness.database)) {
      preferences = queuePendingOrdinaryJoin(harness, bob, pause);
    }
    assertThat(preferences.join()).isEqualTo(Optional.of(SELECTED));
    harness.ticks(20);
    assertThat(harness.inMatch(bob)).isFalse();
    assertThat(bob.getGameMode()).isEqualTo(GameMode.SPECTATOR);
    assertThat(snapshots.loadAll().join()).anyMatch(row -> row.player().equals(bob.getUniqueId()));
    var previous = harness.snapshot().matchId();
    assertThat(((MatchRunner) harness.view()).handle(new MatchEvent.Stop())).isEmpty();
    harness.until(() -> harness.inMatch(bob));
    assertThat(harness.snapshot().matchId()).isNotEqualTo(previous);
    assertThat(((MatchRunner) harness.view()).memberOf(bob.getUniqueId()).orElseThrow().streaks())
        .isEqualTo(SELECTED);
    bob.performCommand("rwf leave");
    assertThat(bob.getInventory().contains(Material.DIAMOND, 5)).isTrue();
    assertThat(bob.getWorld()).isEqualTo(harness.overworld);
  }

  @Test
  void anUnrenewedOrdinaryReadCannotJoinADifferentMatch() {
    var harness = start();
    var bob = prepareOrdinaryJoin(harness);
    CompletableFuture<?> preferences;
    try (var pause = new PreferenceReadPause(harness.database)) {
      bob.performCommand("rwf join");
      harness.until(pause::entered);
      preferences = pendingRead(harness, bob.getUniqueId());
      var previous = harness.snapshot().matchId();
      assertThat(((MatchRunner) harness.view()).handle(new MatchEvent.Stop())).isEmpty();
      harness.until(() -> !harness.snapshot().matchId().equals(previous));
    }
    assertThat(preferences.join()).isEqualTo(Optional.of(SELECTED));
    harness.ticks(20);
    assertThat(harness.inMatch(bob)).isFalse();
    assertThat(bob.getGameMode()).isEqualTo(GameMode.SURVIVAL);
    assertThat(bob.getInventory().contains(Material.DIAMOND, 5)).isTrue();
  }

  private enum Rewatch {
    WATCH_ONLY,
    JOIN_AGAIN
  }

  @ParameterizedTest
  @EnumSource(Rewatch.class)
  void aCancelledEarlierReadCannotOwnAReplacementWatcherSession(Rewatch rewatch) {
    var harness = start();
    var bob = prepareOrdinaryJoin(harness);
    CompletableFuture<?> original;
    Optional<CompletableFuture<?>> replacement = Optional.empty();
    try (var pause = new PreferenceReadPause(harness.database)) {
      original = queuePendingOrdinaryJoin(harness, bob, pause);
      openNextLobby(harness, bob);
      bob.performCommand("rwf leave");
      bob.performCommand("rwf spectate");
      harness.until(() -> bob.getGameMode() == GameMode.SPECTATOR);
      var snapshots = new JooqSnapshotStore(harness.database);
      harness.until(
          () ->
              snapshots.loadAll().join().stream()
                  .anyMatch(row -> row.player().equals(bob.getUniqueId())));
      harness.ticks(2);
      if (rewatch == Rewatch.JOIN_AGAIN) {
        bob.performCommand("rwf join");
        harness.until(
            () ->
                RwfHarness.messages(bob).stream()
                    .anyMatch(message -> message.contains("Loading your killstreak preferences")));
        replacement = Optional.of(pendingRead(harness, bob.getUniqueId()));
        assertThat(replacement.orElseThrow()).isNotSameAs(original);
      }
    }
    assertThat(original.join()).isEqualTo(Optional.of(SELECTED));
    replacement.ifPresent(future -> assertThat(future.join()).isEqualTo(Optional.of(SELECTED)));
    if (rewatch == Rewatch.JOIN_AGAIN) {
      harness.until(() -> harness.inMatch(bob));
      assertThat(((MatchRunner) harness.view()).memberOf(bob.getUniqueId()).orElseThrow().streaks())
          .isEqualTo(SELECTED);
    } else {
      harness.ticks(20);
      assertThat(harness.inMatch(bob)).isFalse();
      assertThat(bob.getGameMode()).isEqualTo(GameMode.SPECTATOR);
    }
    bob.performCommand("rwf leave");
    assertThat(bob.getInventory().contains(Material.DIAMOND, 5)).isTrue();
    assertThat(bob.getWorld()).isEqualTo(harness.overworld);
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
          || !(reads.get(player) instanceof Record read))
        throw new IllegalStateException("expected a pending real preference read");
      var accessor = read.getClass().getDeclaredMethod("future");
      if (accessor.getReturnType() != CompletableFuture.class
          || !accessor.trySetAccessible()
          || !(accessor.invoke(read) instanceof CompletableFuture<?> future))
        throw new IllegalStateException("pending preference future contract changed");
      return future;
    } catch (ReflectiveOperationException error) {
      throw new IllegalStateException("cannot observe submitted preference read", error);
    }
  }

  /** Holds only actual preference SELECTs; watcher snapshot writes and reads still progress. */
  private static final class PreferenceReadPause implements AutoCloseable {
    private final CompletableFuture<Void> release = new CompletableFuture<>();
    private final CompletableFuture<Void> entered = new CompletableFuture<>();
    private final Configuration configuration;
    private final ExecuteListenerProvider[] listeners;

    PreferenceReadPause(StormDatabase database) {
      configuration = databaseDsl(database).configuration();
      listeners = configuration.executeListenerProviders();
      configuration.setAppending(
          ExecuteListener.onExecuteStart(
              context -> {
                var sql = context.sql();
                if (context.type() == ExecuteType.READ
                    && sql != null
                    && sql.contains("rwf_streak_prefs")) {
                  entered.complete(null);
                  release.join();
                }
              }));
    }

    boolean entered() {
      return entered.isDone();
    }

    @Override
    public void close() {
      release.complete(null);
      configuration.set(listeners);
    }

    private static DSLContext databaseDsl(StormDatabase database) {
      try {
        var field = StormDatabase.class.getDeclaredField("dsl");
        if (field.getType() != DSLContext.class
            || !field.trySetAccessible()
            || !(field.get(database) instanceof DSLContext dsl))
          throw new IllegalStateException("test database DSL contract changed");
        return dsl;
      } catch (ReflectiveOperationException error) {
        throw new IllegalStateException("cannot install the preference read barrier", error);
      }
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
