package com.shepherdjerred.thestorm.qol.app;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Graves and first-seen times. Futures complete off the main thread. */
public interface QolStore {

  /** The player's row, inserting {@code now} as first seen when they have none. */
  CompletableFuture<Ensured> ensure(UUID player, Instant now);

  /** Records a successful random teleport. */
  CompletableFuture<Void> setLastRtp(UUID player, Instant when);

  /** Inserts {@code grave}. */
  CompletableFuture<Void> insertGrave(StoredGrave grave);

  /** The grave whose chest is at this block, if one is stored. */
  CompletableFuture<Optional<StoredGrave>> graveAt(String world, int x, int y, int z);

  /** Graves whose expiry is at or before {@code now}. */
  CompletableFuture<List<StoredGrave>> due(Instant now);

  /** Deletes the grave. */
  CompletableFuture<Void> deleteGrave(UUID id);
}
