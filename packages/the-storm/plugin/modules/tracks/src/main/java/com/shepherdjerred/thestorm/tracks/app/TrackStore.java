package com.shepherdjerred.thestorm.tracks.app;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.tracks.domain.TrackProgress;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Function;

/**
 * Where track progress is kept: the source of truth that permissions and the level cache follow.
 * Futures complete off the main thread.
 */
public interface TrackStore {

  /** {@code player}'s stored progress; empty for a player who never trained. */
  CompletableFuture<TrackProgress> load(UUID player);

  /**
   * Reads {@code player}'s progress, applies {@code change} and stores the result if it succeeds,
   * all in one transaction, so no other change can interleave. Returns the progress as stored
   * (which may be less precise than what the change returned, such as times kept to the
   * millisecond), or the change's error with nothing written.
   */
  <E> CompletableFuture<Result<TrackProgress, E>> update(
      UUID player, Function<TrackProgress, Result<TrackProgress, E>> change);
}
