package com.shepherdjerred.thestorm.arena.app.store;

import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;

/** Durable exact-block backup written before a settlement provision or recovery begins. */
public interface SettlementStore {
  enum Status {
    APPLYING,
    APPLIED,
    RESTORING,
    RESTORED
  }

  record Change(BlockPos block, String before, String after) {}

  record Backup(String token, String world, List<Change> changes, Status status) {
    public Backup {
      changes = List.copyOf(changes);
    }
  }

  CompletableFuture<Void> save(Backup backup);

  CompletableFuture<Optional<Backup>> load(String token);

  CompletableFuture<Void> status(String token, Status status);
}
