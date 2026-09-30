package com.shepherdjerred.thestorm.tracks.adapter.luckperms;

import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;

/**
 * Runs asynchronous steps one at a time per key, in submission order: each step starts only after
 * the previous step for the same key has finished, whether it succeeded or failed. Steps for
 * different keys run independently. Thread-safe.
 *
 * @param <K> what steps are serialized on, for example a player's id
 */
final class KeyedQueue<K> {

  private final Map<K, CompletableFuture<Void>> tails = new ConcurrentHashMap<>();

  /**
   * Queues {@code step} behind every earlier step for {@code key}. The returned future completes
   * like the step's own future.
   */
  CompletableFuture<Void> submit(K key, Supplier<CompletableFuture<Void>> step) {
    var tail =
        tails.compute(
            key,
            (ignored, previous) ->
                (previous == null
                        ? CompletableFuture.completedFuture(Boolean.TRUE)
                        : previous.handle((value, failure) -> Boolean.TRUE))
                    .thenCompose(ready -> run(step)));
    var _ = tail.whenComplete((value, failure) -> tails.remove(key, tail));
    return tail.copy();
  }

  /** How many keys have steps queued or running, for tests. */
  int activeKeys() {
    return tails.size();
  }

  private static CompletableFuture<Void> run(Supplier<CompletableFuture<Void>> step) {
    try {
      return step.get();
    } catch (RuntimeException e) {
      return CompletableFuture.failedFuture(e);
    }
  }
}
