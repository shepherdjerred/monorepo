package com.shepherdjerred.thestorm.essentials.app.store;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Every player who has joined: their last-known name and when they first joined. */
public interface PlayerStore {

  /**
   * Records a join, remembering {@code name}. Completes with true when this is the player's first
   * join since essentials started tracking.
   */
  CompletableFuture<Boolean> recordJoin(KnownPlayer player);

  /** Every known player. */
  CompletableFuture<List<KnownPlayer>> all();

  /**
   * A player essentials has seen.
   *
   * @param uuid their id
   * @param name their name when last seen
   * @param lastSeen when they last joined
   */
  record KnownPlayer(UUID uuid, String name, Instant lastSeen) {}
}
