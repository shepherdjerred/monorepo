package com.shepherdjerred.thestorm.arena.app.store;

import com.shepherdjerred.thestorm.arena.domain.snapshot.Snapshot;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Snapshots of players inside arenas. A restore first marks the snapshot restored (before the
 * player's data is saved), so a marked snapshot is never restored again even if deleting it later
 * fails or the server stops first.
 */
public interface SnapshotStore {

  /** Stores {@code snapshot} unrestored, replacing any earlier one of the same player. */
  CompletableFuture<Void> save(Snapshot snapshot);

  /**
   * Marks {@code player}'s snapshot restored at {@code at}. True if an unrestored snapshot was
   * marked; false if there was none (or it was already marked).
   */
  CompletableFuture<Boolean> markRestored(UUID player, Instant at);

  /** Deletes {@code player}'s snapshot if it is marked restored; an unrestored one is kept. */
  CompletableFuture<Void> deleteRestored(UUID player);

  /**
   * Every snapshot not yet restored: those left behind by a crash, read back at startup. Marked
   * snapshots are never returned.
   */
  CompletableFuture<List<Snapshot>> loadAll();
}
