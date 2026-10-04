package com.shepherdjerred.thestorm.companions.app;

import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;

/** One outstanding world effect per companion. An unresolved journal pauses recovery. */
public interface CompanionStore {
  record Stored(CompanionState state, Optional<String> pending) {}

  CompletableFuture<Map<String, Stored>> load();

  CompletableFuture<Void> save(String id, CompanionState state);

  CompletableFuture<Void> begin(String id, CompanionState state, String effect);

  CompletableFuture<Void> finish(String id, CompanionState state);
}
