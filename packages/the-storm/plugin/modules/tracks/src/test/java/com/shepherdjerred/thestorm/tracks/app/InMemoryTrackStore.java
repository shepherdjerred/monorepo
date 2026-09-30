package com.shepherdjerred.thestorm.tracks.app;

import static java.util.concurrent.CompletableFuture.completedFuture;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.tracks.domain.TrackProgress;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Function;

/**
 * Track progress in a map. Tests can hold loads, fail updates, or change a player's progress just
 * before an update runs, as a concurrent change would.
 */
public final class InMemoryTrackStore implements TrackStore {

  private final Map<UUID, TrackProgress> stored = new HashMap<>();
  private CompletableFuture<Void> loadGate = completedFuture(null);
  private boolean failUpdates;
  private Runnable beforeUpdate = () -> {};
  private int updates;
  private int loads;
  private int failingLoads;

  /** The next {@code count} loads fail. */
  public synchronized void failLoads(int count) {
    failingLoads = count;
  }

  public synchronized int loads() {
    return loads;
  }

  public synchronized void put(UUID player, TrackProgress progress) {
    stored.put(player, progress);
  }

  public synchronized TrackProgress get(UUID player) {
    return stored.getOrDefault(player, TrackProgress.empty());
  }

  public synchronized int updates() {
    return updates;
  }

  /** Loads wait for {@code gate} to complete. */
  public synchronized void holdLoads(CompletableFuture<Void> gate) {
    loadGate = gate;
  }

  /** Every update's future fails without writing. */
  public synchronized void failUpdates() {
    failUpdates = true;
  }

  /** Runs {@code action} inside the next updates, before the change is applied. */
  public synchronized void beforeUpdate(Runnable action) {
    beforeUpdate = action;
  }

  @Override
  public synchronized CompletableFuture<TrackProgress> load(UUID player) {
    loads++;
    if (failingLoads > 0) {
      failingLoads--;
      return CompletableFuture.failedFuture(new IllegalStateException("database is locked"));
    }
    return loadGate.thenApply(ignored -> get(player));
  }

  @Override
  public synchronized <E> CompletableFuture<Result<TrackProgress, E>> update(
      UUID player, Function<TrackProgress, Result<TrackProgress, E>> change) {
    updates++;
    if (failUpdates) {
      return CompletableFuture.failedFuture(new IllegalStateException("database is locked"));
    }
    beforeUpdate.run();
    var result = change.apply(get(player));
    if (result instanceof Result.Ok<TrackProgress, E>(var next)) {
      stored.put(player, next);
    }
    return completedFuture(result);
  }
}
