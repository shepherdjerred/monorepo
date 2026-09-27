package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import com.shepherdjerred.thestorm.towns.domain.land.Claim;
import com.shepherdjerred.thestorm.towns.domain.town.Town;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Where towns and claims are stored. Every method runs off the main thread. */
public interface TownsStore {

  /** Everything stored, ordered after every write already queued. */
  CompletableFuture<TownsSnapshot> loadAll();

  /** Stores a new town and its members. */
  CompletableFuture<Void> createTown(Town town);

  /** Replaces a stored town's name, Governor level and members with {@code town}'s. */
  CompletableFuture<Void> saveTown(Town town);

  /**
   * Saves a departure and transfers the former member's locks wholly on this town's land
   * atomically.
   */
  CompletableFuture<Set<UUID>> saveDeparture(Town town, UUID departed);

  /** Deletes a town and records its treasury payout intent in the same transaction. */
  CompletableFuture<Void> deleteTown(TownPayout payout);

  /** Payout intents left by deleted towns, including after a crash. */
  CompletableFuture<List<TownPayout>> pendingPayouts();

  /** Retires an intent only after its keyed economy transfer has committed. */
  CompletableFuture<Void> clearPayout(TownPayout payout);

  CompletableFuture<Void> addClaim(Claim claim, Instant at);

  /** Adds a claim and records its owner's current Governor level in one transaction. */
  CompletableFuture<Void> addClaimAndSaveTown(Claim claim, Instant at, Town town);

  CompletableFuture<Void> removeClaim(ChunkPos chunk);

  /** Replaces a stored claim's flags and trusted players with {@code claim}'s. */
  CompletableFuture<Void> saveClaim(Claim claim);
}
