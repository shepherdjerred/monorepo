package com.shepherdjerred.thestorm.qol.app.store;

import com.shepherdjerred.thestorm.qol.domain.sort.SortSwitches;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Per-player sort switches. Futures complete off the main thread. */
public interface SortStore {

  CompletableFuture<Map<UUID, SortSwitches>> loadAll();

  CompletableFuture<Void> save(UUID player, SortSwitches switches);
}
