package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.towns.domain.lock.Lock;
import java.util.List;
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
}
