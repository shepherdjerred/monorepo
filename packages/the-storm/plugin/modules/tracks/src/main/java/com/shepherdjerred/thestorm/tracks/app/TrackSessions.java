package com.shepherdjerred.thestorm.tracks.app;

import java.util.UUID;

/**
 * Loads a player's progress into the {@link LevelCache} when they join, reconciles their
 * permissions with it, and drops it when they leave. Main thread.
 */
public final class TrackSessions {

  private final TrackRuntime runtime;

  public TrackSessions(TrackRuntime runtime) {
    this.runtime = runtime;
  }

  /** {@code player} joined: load their progress off the main thread, then publish it. */
  public void joined(UUID player) {
    runtime.cache().joined(player);
    var _ =
        runtime
            .store()
            .load(player)
            .whenCompleteAsync(
                (progress, failure) -> {
                  if (failure != null) {
                    runtime
                        .logger()
                        .error(
                            "Could not load tracks for {}; they cannot train until they rejoin",
                            player,
                            failure);
                    return;
                  }
                  runtime.cache().loaded(player, progress);
                  // A change stored while this load ran is newer; sync that instead.
                  runtime.syncPermissions(
                      player, runtime.cache().progress(player).orElse(progress));
                },
                runtime.mainThread());
  }

  /** {@code player} left. */
  public void quit(UUID player) {
    runtime.cache().quit(player);
  }
}
