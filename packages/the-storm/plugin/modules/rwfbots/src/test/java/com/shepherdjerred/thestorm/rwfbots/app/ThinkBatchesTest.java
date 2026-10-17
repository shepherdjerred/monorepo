package com.shepherdjerred.thestorm.rwfbots.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.compute.ComputePool;
import java.util.ArrayDeque;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicIntegerArray;
import java.util.function.Function;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

final class ThinkBatchesTest {
  private static final class QueuedPool implements ComputePool {
    final ArrayDeque<Runnable> jobs = new ArrayDeque<>();

    @Override
    public Executor executor() {
      return jobs::add;
    }

    @Override
    public int parallelism() {
      return 3;
    }

    @Override
    public void close() {}
  }

  @Test
  void boundedBatchesKeepInputOrderWhenWorkersFinishInReverseOrder() {
    var pool = new QueuedPool();
    var result = new ThinkBatches(pool).map(List.of(0, 1, 2, 3, 4, 5, 6), value -> value * 2);
    assertThat(pool.jobs).hasSize(3);
    while (!pool.jobs.isEmpty()) pool.jobs.removeLast().run();
    assertThat(result.resultNow()).containsExactly(0, 2, 4, 6, 8, 10, 12);
  }

  @Test
  void availableWorkersClaimRemainingInputsWhileOneWorkspaceIsBusy() throws Exception {
    var pool = new QueuedPool();
    var entered = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var active = new AtomicIntegerArray(3);
    var visited = new ConcurrentLinkedQueue<Integer>();
    var executor = Executors.newSingleThreadExecutor();
    try {
      var result =
          new ThinkBatches(pool)
              .balanced(
                  null,
                  List.of(0, 1, 2, 3, 4, 5, 6),
                  (workspace, value) -> {
                    assertThat(active.getAndIncrement(workspace)).isZero();
                    try {
                      if (value == 0) {
                        entered.countDown();
                        await(release);
                      }
                      visited.add(value);
                      return value * 2;
                    } finally {
                      assertThat(active.decrementAndGet(workspace)).isZero();
                    }
                  });
      assertThat(pool.jobs).hasSize(3);
      var first = CompletableFuture.runAsync(pool.jobs.removeFirst(), executor);
      assertThat(entered.await(5, TimeUnit.SECONDS)).isTrue();
      pool.jobs.removeFirst().run();
      assertThat(visited).containsExactly(1, 2, 3, 4, 5, 6);
      pool.jobs.removeFirst().run();
      assertThat(result.isDone()).isFalse();
      release.countDown();
      first.get(5, TimeUnit.SECONDS);
      assertThat(result.get(5, TimeUnit.SECONDS)).containsExactly(0, 2, 4, 6, 8, 10, 12);
      assertThat(visited).containsExactlyInAnyOrder(0, 1, 2, 3, 4, 5, 6);
    } finally {
      release.countDown();
      executor.shutdownNow();
      assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
    }
  }

  @Test
  void balancedFailureAndPartialRejectionWaitForEverySubmittedSibling() {
    for (var rejectMiddle : List.of(false, true)) {
      var queue = new ArrayDeque<Runnable>();
      var submitted = new AtomicInteger();
      ComputePool pool =
          new ComputePool() {
            @Override
            public Executor executor() {
              return job -> {
                if (submitted.getAndIncrement() == 1 && rejectMiddle)
                  throw new RejectedExecutionException("middle job rejected");
                queue.add(job);
              };
            }

            @Override
            public int parallelism() {
              return 3;
            }

            @Override
            public void close() {}
          };
      var result =
          new ThinkBatches(pool)
              .balanced(
                  null,
                  List.of(0, 1, 2, 3, 4, 5),
                  (workspace, value) -> {
                    if (value == 0 && !rejectMiddle)
                      throw new IllegalStateException("failed operation");
                    return value;
                  });
      assertThat(submitted).hasValue(3);
      queue.removeFirst().run();
      assertThat(result.isDone()).isFalse();
      while (!queue.isEmpty()) queue.removeLast().run();
      assertThat(result.isCompletedExceptionally()).isTrue();
      assertThatThrownBy(result::join)
          .hasCauseInstanceOf(
              rejectMiddle ? RejectedExecutionException.class : IllegalStateException.class);
    }
  }

  private static void await(CountDownLatch latch) {
    try {
      if (!latch.await(5, TimeUnit.SECONDS))
        throw new IllegalStateException("worker release timed out");
    } catch (InterruptedException interrupted) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException(interrupted);
    }
  }

  @Test
  void aFailedBatchStillWaitsForAllSiblingsBeforeCompletingTheStage() {
    var pool = new QueuedPool();
    var result =
        new ThinkBatches(pool)
            .map(
                List.of(0, 1, 2),
                value -> {
                  if (value == 0) throw new IllegalStateException("failed batch");
                  return value;
                });
    pool.jobs.removeFirst().run();
    assertThat(result.isDone()).isFalse();
    while (!pool.jobs.isEmpty()) pool.jobs.removeLast().run();
    assertThat(result.isCompletedExceptionally()).isTrue();
  }

  @Test
  void rejectionRemainsAnExplicitFailure() {
    ComputePool rejected =
        new ComputePool() {
          @Override
          public Executor executor() {
            return task -> {
              throw new RejectedExecutionException("closed");
            };
          }

          @Override
          public int parallelism() {
            return 3;
          }

          @Override
          public void close() {}
        };
    var result = new ThinkBatches(rejected).map(List.of(1, 2, 3), value -> value);
    assertThat(result.isCompletedExceptionally()).isTrue();
    assertThatThrownBy(result::resultNow).isInstanceOf(IllegalStateException.class);
  }

  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void stagesUseMultipleWorkersWithoutBlockingTheSubmittingWorker(boolean balanced)
      throws Exception {
    var executor = Executors.newFixedThreadPool(3);
    ComputePool pool =
        new ComputePool() {
          @Override
          public Executor executor() {
            return executor;
          }

          @Override
          public int parallelism() {
            return 3;
          }

          @Override
          public void close() {
            executor.shutdownNow();
          }
        };
    var started = new CountDownLatch(3);
    try {
      var result =
          CompletableFuture.completedFuture(0)
              .thenComposeAsync(
                  ignored -> {
                    var batches = new ThinkBatches(pool);
                    Function<Integer, Integer> operation =
                        value -> {
                          started.countDown();
                          await(started);
                          return value;
                        };
                    return balanced
                        ? batches.balanced(
                            null, List.of(1, 2, 3), (owner, value) -> operation.apply(value))
                        : batches.map(List.of(1, 2, 3), operation);
                  },
                  pool.executor());
      assertThat(result.get(10, TimeUnit.SECONDS)).containsExactly(1, 2, 3);
    } finally {
      pool.close();
      assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
    }
  }
}
