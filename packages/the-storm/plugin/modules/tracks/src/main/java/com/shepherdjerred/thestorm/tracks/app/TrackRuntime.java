package com.shepherdjerred.thestorm.tracks.app;

import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.tracks.domain.TrackProgress;
import java.time.InstantSource;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;
import org.slf4j.Logger;

/** Shared track services and per-player LuckPerms reconciliation. */
public final class TrackRuntime {

  private final TrackStore store;
  private final PermissionSync permissions;
  private final LevelCache cache;
  private final Scheduler scheduler;
  private final InstantSource time;
  private final Logger logger;
  private final Map<UUID, SyncAttempt> syncing = new ConcurrentHashMap<>();
  private volatile boolean stopped;

  private static final class SyncAttempt {
    int failures;
  }

  /** Scheduling, clock and diagnostics shared by track use cases. */
  public record RuntimeServices(Scheduler scheduler, InstantSource time, Logger logger) {}

  public TrackRuntime(
      TrackStore store, PermissionSync permissions, LevelCache cache, RuntimeServices services) {
    this.store = store;
    this.permissions = permissions;
    this.cache = cache;
    this.scheduler = services.scheduler();
    this.time = services.time();
    this.logger = services.logger();
  }

  public TrackStore store() {
    return store;
  }

  public PermissionSync permissions() {
    return permissions;
  }

  public LevelCache cache() {
    return cache;
  }

  public Scheduler scheduler() {
    return scheduler;
  }

  public InstantSource time() {
    return time;
  }

  public Logger logger() {
    return logger;
  }

  /** Runs work on the server's main thread. */
  Executor mainThread() {
    return scheduler.mainThread();
  }

  /**
   * {@code player}'s progress was stored as {@code progress}: refresh the cache and their
   * permissions. Main thread.
   */
  void changed(UUID player, TrackProgress progress) {
    cache.changed(player, progress);
    syncPermissions(player);
  }

  /** Applies the latest levels, retrying failures while the player remains online. Main thread. */
  public void syncPermissions(UUID player) {
    if (stopped) return;
    var attempt = new SyncAttempt();
    syncing.put(player, attempt);
    apply(player, attempt);
  }

  /** Ends retries from an old join session before a player can reconnect. */
  void stopPermissions(UUID player) {
    syncing.remove(player);
  }

  /** Ends outstanding retries when the module shuts down. */
  public void stop() {
    stopped = true;
    syncing.clear();
  }

  private void apply(UUID player, SyncAttempt attempt) {
    if (stopped || syncing.get(player) != attempt) return;
    var _ =
        permissions
            .apply(player)
            .whenCompleteAsync(
                (ignored, failure) -> {
                  if (stopped || syncing.get(player) != attempt) return;
                  if (failure == null) {
                    syncing.remove(player, attempt);
                    return;
                  }
                  if (cache.state(player).isEmpty()) {
                    syncing.remove(player, attempt);
                    logger.error(
                        "Could not sync track permissions for offline {}", player, failure);
                    return;
                  }
                  attempt.failures++;
                  var delay = TrackSessions.retryDelay(attempt.failures);
                  logger.error(
                      "Could not sync track permissions for {} (attempt {}); retrying in {}",
                      player,
                      attempt.failures,
                      delay,
                      failure);
                  var _ =
                      scheduler.runOnMainThreadLater(
                          delay,
                          () -> {
                            if (cache.state(player).isPresent()) {
                              apply(player, attempt);
                            } else {
                              syncing.remove(player, attempt);
                            }
                          });
                },
                mainThread());
  }
}
