package com.shepherdjerred.thestorm.core.compute;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import org.slf4j.event.SubstituteLoggingEvent;
import org.slf4j.helpers.SubstituteLogger;

final class PlatformComputePoolTest {

  /** Records what the pool logs, the way slf4j buffers events before a backend is bound. */
  private final LinkedBlockingQueue<SubstituteLoggingEvent> logged = new LinkedBlockingQueue<>();

  private final SubstituteLogger logger = new SubstituteLogger("compute", logged, false);

  @Test
  void submittedWorkRunsOnNamedDaemonComputeThreads() {
    var pool = new PlatformComputePool(2, logger);
    try {
      var worker = pool.submit(Thread::currentThread).join();
      assertThat(worker.getName()).startsWith("storm-compute-");
      assertThat(worker.isDaemon()).isTrue();
      assertThat(worker).isNotSameAs(Thread.currentThread());
    } finally {
      pool.close();
    }
  }

  @Test
  void workNeverRunsOnMoreThreadsThanTheSize() {
    var pool = new PlatformComputePool(2, logger);
    try {
      var names =
          IntStream.range(0, 20)
              .mapToObj(ignored -> pool.submit(() -> Thread.currentThread().getName()))
              .toList();
      var distinct = names.stream().map(CompletableFuture::join).distinct().toList();
      assertThat(distinct).hasSizeBetween(1, 2);
    } finally {
      pool.close();
    }
  }

  @Test
  void closeIsIdempotentAndRejectsLaterWork() {
    var pool = new PlatformComputePool(1, logger);
    pool.close();
    pool.close();
    assertThatThrownBy(() -> pool.executor().execute(() -> {}))
        .isInstanceOf(RejectedExecutionException.class);
    assertThatThrownBy(() -> pool.submit(() -> 1)).isInstanceOf(RejectedExecutionException.class);
  }

  @Test
  void closeWaitsForRunningWork() throws InterruptedException {
    var pool = new PlatformComputePool(1, logger);
    var started = new CountDownLatch(1);
    var finished = new CountDownLatch(1);
    pool.executor()
        .execute(
            () -> {
              started.countDown();
              try {
                Thread.sleep(Duration.ofMillis(200));
              } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
              }
              finished.countDown();
            });
    assertThat(started.await(5, TimeUnit.SECONDS)).isTrue();
    pool.close();
    assertThat(finished.getCount()).isZero();
  }

  @Test
  void uncaughtFailuresAreLoggedThroughThePluginLogger() throws InterruptedException {
    var pool = new PlatformComputePool(1, logger);
    try {
      pool.executor()
          .execute(
              () -> {
                throw new IllegalStateException("boom");
              });
      var event = logged.poll(5, TimeUnit.SECONDS);
      assertThat(event).isNotNull();
      assertThat(event.getMessage()).contains("Compute work on {} failed");
      assertThat(event.getArgumentArray()).singleElement().asString().startsWith("storm-compute-");
      assertThat(event.getThrowable()).isInstanceOf(IllegalStateException.class);
    } finally {
      pool.close();
    }
  }

  @Test
  void sizeLeavesTheServerACoreAndCapsAtFour() {
    assertThat(PlatformComputePool.size(1)).isEqualTo(1);
    assertThat(PlatformComputePool.size(2)).isEqualTo(1);
    assertThat(PlatformComputePool.size(4)).isEqualTo(3);
    assertThat(PlatformComputePool.size(16)).isEqualTo(4);
  }

  @Test
  void refusesAnEmptyPool() {
    assertThatThrownBy(() -> new PlatformComputePool(0, logger))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
