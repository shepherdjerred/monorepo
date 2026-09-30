package com.shepherdjerred.thestorm.towns.app;

import com.shepherdjerred.thestorm.towns.domain.pvp.PvpSetting;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Where players' own PvP switches are stored. Every method runs off the main thread. */
public interface PvpStore {

  /** Every player who has changed their switch, ordered after every write already queued. */
  CompletableFuture<Map<UUID, PvpSetting>> loadAll();

  /** Stores {@code player}'s switch. */
  CompletableFuture<Void> save(UUID player, PvpSetting setting);
}
