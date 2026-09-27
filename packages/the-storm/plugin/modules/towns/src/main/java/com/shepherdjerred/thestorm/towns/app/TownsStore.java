package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import com.shepherdjerred.thestorm.towns.domain.land.Claim;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Where towns and claims are stored. Every method runs off the main thread. */
public interface TownsStore {

  /** Everything stored, ordered after every write already queued. */
  CompletableFuture<TownsSnapshot> loadAll();

  /** Stores a new town and its members. */
  CompletableFuture<Void> createTown(Town town);

  /** Deletes a town with its members and claims. */
  CompletableFuture<Void> deleteTown(UUID townId);

  CompletableFuture<Void> addClaim(Claim claim, Instant at);

  CompletableFuture<Void> removeClaim(ChunkPos chunk);

  /** Replaces a stored claim's flags with {@code claim}'s. */
  CompletableFuture<Void> saveFlags(Claim claim);
}
