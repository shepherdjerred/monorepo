package com.shepherdjerred.thestorm.tracks.app;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.tracks.domain.AdminChanges;
import com.shepherdjerred.thestorm.tracks.domain.AdminProblem;
import com.shepherdjerred.thestorm.tracks.domain.TrackProgress;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Administrator changes to any player's tracks, online or not. Nothing is charged or refunded.
 * Futures complete on the main thread.
 */
public final class TrackAdmin {

  private final TrackRuntime runtime;

  public TrackAdmin(TrackRuntime runtime) {
    this.runtime = runtime;
  }

  /** Sets {@code player}'s level in {@code track}; see {@link AdminChanges#set}. */
  public CompletableFuture<Result<TrackProgress, AdminProblem>> set(
      UUID player, Track track, int level) {
    return runtime
        .store()
        .update(player, progress -> AdminChanges.set(progress, track, level))
        .thenApplyAsync(
            result -> {
              if (result instanceof Result.Ok<TrackProgress, AdminProblem>(var stored)) {
                runtime.changed(player, stored);
              }
              return result;
            },
            runtime.mainThread());
  }

  /** Clears {@code player}'s levels, primary and cooldown. Nothing is refunded. */
  public CompletableFuture<TrackProgress> reset(UUID player) {
    return runtime
        .store()
        .update(player, progress -> Result.<TrackProgress, AdminProblem>ok(AdminChanges.reset()))
        .thenApplyAsync(
            result ->
                result.fold(
                    stored -> {
                      runtime.changed(player, stored);
                      return stored;
                    },
                    problem -> {
                      throw new IllegalStateException("a reset cannot be refused: " + problem);
                    }),
            runtime.mainThread());
  }
}
