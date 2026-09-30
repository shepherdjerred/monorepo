package com.shepherdjerred.thestorm.tracks.app;

import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import org.slf4j.Logger;

/** Declares the external LuckPerms groups before paid track levels become available. */
public final class TrackGroupDeclarations {

  private final PermissionSync permissions;
  private final Scheduler scheduler;
  private final Logger logger;
  private final Runnable onReady;
  private volatile boolean ready;
  private volatile boolean stopped;

  public TrackGroupDeclarations(
      PermissionSync permissions, Scheduler scheduler, Logger logger, Runnable onReady) {
    this.permissions = permissions;
    this.scheduler = scheduler;
    this.logger = logger;
    this.onReady = onReady;
  }

  /** Whether every managed group has been saved successfully. */
  public boolean ready() {
    return ready && !stopped;
  }

  /** Starts declaration; a failed attempt is retried with bounded backoff. */
  public void start() {
    declare(0);
  }

  /** Prevents a delayed retry or completion from enabling purchases after shutdown. */
  public void stop() {
    stopped = true;
    ready = false;
  }

  private void declare(int failures) {
    if (stopped) return;
    var _ =
        permissions
            .declareGroups()
            .whenCompleteAsync(
                (ignored, failure) -> {
                  if (stopped) return;
                  if (failure == null) {
                    ready = true;
                    onReady.run();
                    return;
                  }
                  var attempt = failures + 1;
                  var delay = TrackSessions.retryDelay(attempt);
                  logger.error(
                      "Could not declare track groups (attempt {}); purchases remain disabled;"
                          + " retrying in {}",
                      attempt,
                      delay,
                      failure);
                  var _ = scheduler.runOnMainThreadLater(delay, () -> declare(attempt));
                },
                scheduler.mainThread());
  }
}
