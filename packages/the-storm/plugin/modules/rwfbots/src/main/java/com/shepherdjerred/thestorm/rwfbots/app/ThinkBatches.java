package com.shepherdjerred.thestorm.rwfbots.app;

import com.shepherdjerred.thestorm.core.compute.ComputePool;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.RejectedExecutionException;
import java.util.function.BiFunction;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;

/** Bounded CPU batches with ordered results and asynchronous barriers, including failed tasks. */
final class ThinkBatches {
  private final ComputePool pool;

  ThinkBatches(ComputePool pool) {
    this.pool = pool;
    if (pool.parallelism() < 1) throw new IllegalArgumentException("empty compute pool");
  }

  <T, R> CompletableFuture<List<R>> map(List<T> inputs, Function<T, R> operation) {
    return indexed(inputs, (batch, input) -> operation.apply(input));
  }

  <T, R> CompletableFuture<List<R>> map(
      ThinkFlight.@Nullable Context context, List<T> inputs, Function<T, R> operation) {
    return indexed(context, inputs, (batch, input) -> operation.apply(input));
  }

  <T, R> CompletableFuture<List<R>> indexed(List<T> inputs, BiFunction<Integer, T, R> operation) {
    return indexed(null, inputs, operation);
  }

  <T, R> CompletableFuture<List<R>> indexed(
      ThinkFlight.@Nullable Context context, List<T> inputs, BiFunction<Integer, T, R> operation) {
    if (inputs.isEmpty()) return CompletableFuture.completedFuture(List.of());
    if (pool.parallelism() == 1) {
      try {
        return CompletableFuture.completedFuture(
            inputs.stream().map(input -> operation.apply(0, input)).toList());
      } catch (RuntimeException failure) {
        return CompletableFuture.failedFuture(failure);
      }
    }
    var count = Math.min(pool.parallelism(), inputs.size());
    var jobs = new ArrayList<CompletableFuture<List<R>>>(count);
    for (var batch = 0; batch < count; batch++) {
      var index = batch;
      try {
        var trace = ThinkFlight.queued(context, index, (inputs.size() + count - 1 - index) / count);
        jobs.add(pool.submit(() -> trace.measure(() -> batch(inputs, operation, index, count))));
      } catch (RejectedExecutionException rejected) {
        jobs.add(CompletableFuture.failedFuture(rejected));
      }
    }
    return CompletableFuture.allOf(jobs.toArray(CompletableFuture<?>[]::new))
        .thenApply(ignored -> ordered(jobs, inputs.size()));
  }

  private static <T, R> List<R> batch(
      List<T> inputs, BiFunction<Integer, T, R> operation, int index, int count) {
    var results = new ArrayList<R>();
    for (var i = index; i < inputs.size(); i += count)
      results.add(operation.apply(index, inputs.get(i)));
    return List.copyOf(results);
  }

  private static <R> List<R> ordered(List<CompletableFuture<List<R>>> jobs, int size) {
    // allOf completed successfully: resultNow never waits for another pool worker.
    var batches = jobs.stream().map(CompletableFuture::resultNow).toList();
    var results = new ArrayList<R>(size);
    for (var i = 0; i < size; i++) {
      results.add(batches.get(i % batches.size()).get(i / batches.size()));
    }
    return List.copyOf(results);
  }
}
