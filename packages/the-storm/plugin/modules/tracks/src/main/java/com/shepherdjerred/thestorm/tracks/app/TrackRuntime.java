package com.shepherdjerred.thestorm.tracks.app;

import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import com.shepherdjerred.thestorm.tracks.domain.TrackProgress;
import java.time.InstantSource;
import java.util.UUID;
import java.util.concurrent.Executor;
import org.slf4j.Logger;

/**
 * What the tracks' use cases share.
 *
 * @param store the source of truth
 * @param permissions the permission grants that follow it
 * @param cache online players' progress
 * @param scheduler the main thread, now or later
 * @param time the clock
 * @param logger where failures are reported
 */
public record TrackRuntime(
    TrackStore store,
    PermissionSync permissions,
    LevelCache cache,
    Scheduler scheduler,
    InstantSource time,
    Logger logger) {

  /** Runs work on the server's main thread. */
  Executor mainThread() {
    return scheduler.mainThread();
  }

  /**
   * {@code player}'s progress was stored as {@code progress}: refresh the cache and their
   * permissions. Main thread. A failed permission sync is logged; the next join retries it.
   */
  void changed(UUID player, TrackProgress progress) {
    cache.changed(player, progress);
    syncPermissions(player);
  }

  /** Brings {@code player}'s permissions in line with their stored progress, logging failures. */
  void syncPermissions(UUID player) {
    var _ =
        permissions
            .apply(player)
            .whenComplete(
                (ignored, failure) -> {
                  if (failure != null) {
                    logger.error(
                        "Could not sync track permissions for {}; they are retried on their next"
                            + " join",
                        player,
                        failure);
                  }
                });
  }
}
