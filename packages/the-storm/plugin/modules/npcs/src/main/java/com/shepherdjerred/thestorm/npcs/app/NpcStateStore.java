package com.shepherdjerred.thestorm.npcs.app;

import com.shepherdjerred.thestorm.npcs.domain.combat.NpcLedger.Snapshot;
import java.util.concurrent.CompletableFuture;

/** Durable NPC state. Implementations serialize writes and hydrate before reconciliation. */
public interface NpcStateStore {
  CompletableFuture<Snapshot> load();

  CompletableFuture<Void> save(Snapshot snapshot);
}
