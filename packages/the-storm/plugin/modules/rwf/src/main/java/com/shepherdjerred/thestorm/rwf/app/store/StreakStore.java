package com.shepherdjerred.thestorm.rwf.app.store;

import com.shepherdjerred.thestorm.rwf.domain.killstreak.StreakLoadout;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** A human's preferred rewards; absence is a new player, and malformed stored values fail. */
public interface StreakStore {
  CompletableFuture<Optional<StreakLoadout>> load(UUID player);

  CompletableFuture<Void> save(UUID player, StreakLoadout loadout);
}
