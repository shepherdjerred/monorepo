package com.shepherdjerred.thestorm.core.players;

import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Players who have joined The Storm, by id and by last-known name. Futures complete off the main
 * thread; hop back with {@code Scheduler.mainThread()}.
 */
public interface PlayerDirectory {

  /**
   * The player who most recently joined with {@code name}, ignoring case. Empty if nobody with that
   * name has joined.
   */
  CompletableFuture<Optional<KnownPlayer>> byName(String name);

  /** The player with {@code uuid}, if they have ever joined. */
  CompletableFuture<Optional<KnownPlayer>> byId(UUID uuid);
}
