package com.shepherdjerred.thestorm.tracks.app;

import com.shepherdjerred.thestorm.tracks.domain.TrackGroups;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Grants track levels as permissions, following the stored progress. Both operations are idempotent
 * reconciliations, safe to repeat. Futures complete off the main thread.
 */
public interface PermissionSync {

  /** Creates any missing {@link TrackGroups#definitions() track group} and its permission. */
  CompletableFuture<Void> declareGroups();

  /**
   * Makes {@code player}'s track group memberships exactly {@link TrackGroups#memberships} of their
   * progress as stored when the apply runs. Applies for one player run in the order requested.
   */
  CompletableFuture<Void> apply(UUID player);
}
