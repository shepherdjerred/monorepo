package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.towns.domain.lock.Lock;
import com.shepherdjerred.thestorm.towns.domain.lock.LockModes;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Where locks are stored. Every method runs off the main thread. */
public interface LocksStore {

  /** Every lock, ordered after every write already queued. */
  CompletableFuture<List<Lock>> loadAll();

  /** Stores {@code lock}, replacing the stored lock with its id: its blocks and trusted players. */
  CompletableFuture<Void> save(Lock lock);

  /** Deletes the lock with {@code id}. */
  CompletableFuture<Void> delete(UUID id);

  /** Every player's sticky modes. A player with no row is absent. */
  CompletableFuture<Map<UUID, LockModes>> loadModes();

  /** Stores {@code modes} for {@code player}, replacing the previous row. */
  CompletableFuture<Void> saveMode(UUID player, LockModes modes);
}
