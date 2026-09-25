package com.shepherdjerred.thestorm.arena.app.store;

import com.shepherdjerred.thestorm.arena.domain.snapshot.Snapshot;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Snapshots of players inside arenas, kept until they are restored. */
public interface SnapshotStore {

  /** Stores {@code snapshot}, replacing any earlier one of the same player. */
  CompletableFuture<Void> save(Snapshot snapshot);

  /** Deletes {@code player}'s snapshot, if any. */
  CompletableFuture<Void> delete(UUID player);

  /** Every stored snapshot: those left behind by a crash, read back at startup. */
  CompletableFuture<List<Snapshot>> loadAll();
}
