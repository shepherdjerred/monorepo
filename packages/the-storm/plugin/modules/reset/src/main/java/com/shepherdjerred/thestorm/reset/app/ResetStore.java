package com.shepherdjerred.thestorm.reset.app;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Durable reset markers that keep incomplete accounts out of the server. */
public interface ResetStore {

  CompletableFuture<Void> begin(UUID player, Instant startedAt);

  CompletableFuture<Set<UUID>> pending();

  CompletableFuture<Boolean> isPending(UUID player);

  CompletableFuture<Void> finish(UUID player);
}
