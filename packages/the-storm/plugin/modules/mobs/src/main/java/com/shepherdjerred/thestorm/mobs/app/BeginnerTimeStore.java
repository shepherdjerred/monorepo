package com.shepherdjerred.thestorm.mobs.app;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Durable active milliseconds since each account's first enabled beginner session. */
public interface BeginnerTimeStore {
  CompletableFuture<Map<UUID, Long>> load();

  CompletableFuture<Void> save(UUID player, long activeMillis);
}
