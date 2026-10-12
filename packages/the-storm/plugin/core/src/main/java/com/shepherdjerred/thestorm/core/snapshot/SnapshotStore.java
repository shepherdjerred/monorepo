package com.shepherdjerred.thestorm.core.snapshot;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Stored snapshots of players inside a game. Each module implements this over its own table, so two
 * games never share rows. A restore marks its row restored only after a fresh player login proves
 * the matching marker and belongings were saved together in player data.
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
   * Every snapshot not yet confirmed in saved player data, read back at startup. Marked snapshots
   * are never returned.
   */
  CompletableFuture<List<Snapshot>> loadAll();
}
