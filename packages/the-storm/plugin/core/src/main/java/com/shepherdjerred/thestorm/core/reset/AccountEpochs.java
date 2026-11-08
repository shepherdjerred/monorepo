package com.shepherdjerred.thestorm.core.reset;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;

/** Durable revocation generations: an account reset invalidates definitions in unloaded chunks. */
public final class AccountEpochs {
  public interface Store {
    CompletableFuture<Map<UUID, Long>> load();

    CompletableFuture<Long> advance(UUID player);
  }

  private final Store store;
  private final Map<UUID, Long> generations = new ConcurrentHashMap<>();
  private final CompletableFuture<Void> ready;

  public AccountEpochs(Store store) {
    this.store = store;
    ready = store.load().thenAccept(generations::putAll);
  }

  /**
   * Explicit ephemeral policy for isolated runtimes and tests. Production uses SqlAccountEpochs.
   */
  public static AccountEpochs inMemory() {
    return new AccountEpochs(
        new Store() {
          private final Map<UUID, Long> values = new ConcurrentHashMap<>();

          @Override
          public CompletableFuture<Map<UUID, Long>> load() {
            return CompletableFuture.completedFuture(Map.copyOf(values));
          }

          @Override
          public CompletableFuture<Long> advance(UUID player) {
            return CompletableFuture.completedFuture(values.merge(player, 1L, Math::addExact));
          }
        });
  }

  public CompletableFuture<Void> loaded() {
    return ready;
  }

  public long current(UUID player) {
    if (!ready.isDone() || ready.isCompletedExceptionally())
      throw new IllegalStateException("Account revocations are not loaded");
    return generations.getOrDefault(player, 0L);
  }

  public CompletableFuture<Void> retire(UUID player) {
    return ready
        .thenCompose(ignored -> store.advance(player))
        .thenAccept(next -> generations.merge(player, next, Math::max));
  }
}
