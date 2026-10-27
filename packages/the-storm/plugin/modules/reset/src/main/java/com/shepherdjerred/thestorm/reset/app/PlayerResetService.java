package com.shepherdjerred.thestorm.reset.app;

import com.shepherdjerred.thestorm.core.reset.PlayerResetRegistry;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import java.time.InstantSource;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Runs complete resets one at a time per player and resumes interrupted work. */
public final class PlayerResetService {

  /** Main-thread scheduling, the reset marker clock and stage diagnostics. */
  public record Timing(
      Scheduler scheduler, InstantSource time, java.util.function.Consumer<String> log) {}

  private final ResetStore store;
  private final PlayerResetRegistry modules;
  private final ResetOperations operations;
  private final Timing timing;
  private final Map<UUID, CompletableFuture<Void>> running = new HashMap<>();

  public PlayerResetService(
      ResetStore store, PlayerResetRegistry modules, ResetOperations operations, Timing timing) {
    this.store = store;
    this.modules = modules;
    this.operations = operations;
    this.timing = timing;
  }

  /** Starts a reset, or returns the reset already running for this player. Main thread only. */
  public CompletableFuture<Void> reset(UUID player) {
    var existing = running.get(player);
    if (existing != null) {
      return existing;
    }
    var result =
        store
            .begin(player, timing.time().instant())
            .thenRunAsync(() -> operations.kick(player), timing.scheduler().mainThread())
            .thenComposeAsync(ignored -> modules.reset(player), timing.scheduler().mainThread())
            .thenRunAsync(
                () -> timing.log().accept("Module state reset for " + player),
                timing.scheduler().mainThread())
            .thenComposeAsync(
                ignored -> operations.eraseVanilla(player), timing.scheduler().mainThread())
            .thenRunAsync(
                () -> timing.log().accept("Vanilla reset complete for " + player),
                timing.scheduler().mainThread())
            .thenCompose(ignored -> operations.clearPermissions(player))
            .thenRunAsync(
                () -> timing.log().accept("Permissions reset complete for " + player),
                timing.scheduler().mainThread())
            .thenCompose(ignored -> store.finish(player));
    running.put(player, result);
    var _ =
        result.whenCompleteAsync(
            (ignored, failure) -> running.remove(player), timing.scheduler().mainThread());
    return result;
  }

  /** Resumes every durable incomplete reset. Call on the main thread after modules are ready. */
  public CompletableFuture<Void> resume() {
    return store
        .pending()
        .thenComposeAsync(
            pending -> {
              var result = CompletableFuture.<Void>completedFuture(null);
              for (var player : pending) {
                result = result.thenCompose(ignored -> reset(player));
              }
              return result;
            },
            timing.scheduler().mainThread());
  }
}
