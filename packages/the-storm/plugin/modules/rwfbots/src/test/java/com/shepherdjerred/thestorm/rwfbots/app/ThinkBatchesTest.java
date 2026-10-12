package com.shepherdjerred.thestorm.rwfbots.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.compute.ComputePool;
import java.util.ArrayDeque;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

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

  @Test
  void stagesUseMultipleWorkersWithoutBlockingTheSubmittingWorker() throws Exception {
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
                  ignored ->
                      new ThinkBatches(pool)
                          .map(
                              List.of(1, 2, 3),
                              value -> {
                                started.countDown();
                                try {
                                  if (!started.await(5, TimeUnit.SECONDS))
                                    throw new IllegalStateException("serial execution");
                                } catch (InterruptedException interrupted) {
                                  Thread.currentThread().interrupt();
                                  throw new IllegalStateException(interrupted);
                                }
                                return value;
                              }),
                  pool.executor());
      assertThat(result.get(10, TimeUnit.SECONDS)).containsExactly(1, 2, 3);
    } finally {
      pool.close();
      assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
    }
  }
}
