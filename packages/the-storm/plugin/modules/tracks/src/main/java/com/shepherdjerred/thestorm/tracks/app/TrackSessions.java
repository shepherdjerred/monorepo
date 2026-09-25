package com.shepherdjerred.thestorm.tracks.app;

import java.time.Duration;
import java.util.UUID;
import java.util.function.Consumer;

/**
 * Loads a player's progress into the {@link LevelCache} when they join, reconciles their
 * permissions with it, and drops it when they leave. Main thread.
 *
 * <p>A failed load is retried with a doubling delay capped at {@link #MAX_RETRY_DELAY}, for as long
 * as that join's session lasts; the player is told once, on the first failure.
 */
public final class TrackSessions {

  /** The first retry's delay. */
  public static final Duration FIRST_RETRY_DELAY = Duration.ofSeconds(1);

  /** The longest wait between retries. */
  public static final Duration MAX_RETRY_DELAY = Duration.ofMinutes(1);

  private final TrackRuntime runtime;
  private final Consumer<UUID> tellLoadFailed;

  /**
   * @param runtime shared services
   * @param tellLoadFailed tells an online player their tracks could not be loaded
   */
  public TrackSessions(TrackRuntime runtime, Consumer<UUID> tellLoadFailed) {
    this.runtime = runtime;
    this.tellLoadFailed = tellLoadFailed;
  }

  /** The wait before retry number {@code attempt} (1 for the first retry). */
  public static Duration retryDelay(int attempt) {
    if (attempt < 1) {
      throw new IllegalArgumentException("retries count from 1: " + attempt);
    }
    var doublings = Math.min(attempt - 1, 16);
    var delay = FIRST_RETRY_DELAY.multipliedBy(1L << doublings);
    return delay.compareTo(MAX_RETRY_DELAY) > 0 ? MAX_RETRY_DELAY : delay;
  }

  /** {@code player} joined: load their progress off the main thread, then publish it. */
  public void joined(UUID player) {
    load(player, runtime.cache().joined(player), 0);
  }

  /** {@code player} left. */
  public void quit(UUID player) {
    runtime.cache().quit(player);
  }

  private void load(UUID player, long token, int failures) {
    var _ =
        runtime
            .store()
            .load(player)
            .whenCompleteAsync(
                (progress, failure) -> {
                  if (!runtime.cache().isCurrent(player, token)) {
                    return;
                  }
                  if (failure != null) {
                    retry(player, token, failures + 1, failure);
                    return;
                  }
                  runtime.cache().loaded(player, token, progress);
                  runtime.syncPermissions(player);
                },
                runtime.mainThread());
  }

  private void retry(UUID player, long token, int failures, Throwable failure) {
    var delay = retryDelay(failures);
    runtime
        .logger()
        .error(
            "Could not load tracks for {} (attempt {}); retrying in {}",
            player,
            failures,
            delay,
            failure);
    runtime.cache().failed(player, token);
    if (failures == 1) {
      tellLoadFailed.accept(player);
    }
    var _ =
        runtime
            .scheduler()
            .runOnMainThreadLater(
                delay,
                () -> {
                  if (runtime.cache().isCurrent(player, token)) {
                    load(player, token, failures);
                  }
                });
  }
}
