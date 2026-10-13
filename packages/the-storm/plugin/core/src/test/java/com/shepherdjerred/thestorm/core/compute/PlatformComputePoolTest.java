package com.shepherdjerred.thestorm.core.compute;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.result.Result;
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
    var settings = new ComputeSettings(4);
    assertThat(PlatformComputePool.size(1, settings)).isEqualTo(1);
    assertThat(PlatformComputePool.size(2, settings)).isEqualTo(1);
    assertThat(PlatformComputePool.size(4, settings)).isEqualTo(3);
    assertThat(PlatformComputePool.size(16, settings)).isEqualTo(4);
  }

  @Test
  void startupCeilingSupportsTheApprovedCpuWorkerPairsWithoutOversubscribing() {
    for (var pair : new int[][] {{3, 2}, {4, 3}, {6, 4}, {8, 6}, {12, 10}}) {
      var settings = new ComputeSettings(pair[1]);
      assertThat(PlatformComputePool.size(pair[0], settings)).isEqualTo(pair[1]);
      assertThat(PlatformComputePool.size(2, settings)).isEqualTo(1);
    }
    assertThatThrownBy(() -> new ComputeSettings(0)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new ComputeSettings(11)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void refusesAnEmptyPool() {
    assertThatThrownBy(() -> new PlatformComputePool(0, logger))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void startupConfigurationRejectsMissingUnknownOrInvalidValues() {
    assertThat(StrictYaml.parse("compute.yml", "maxThreads: 4", ComputeSettings.class))
        .isEqualTo(Result.ok(new ComputeSettings(4)));
    for (var yaml :
        new String[] {
          "{}",
          "maxThreads: 0",
          "maxThreads: 11",
          "maxThreads: -1",
          "maxThreads: 2.5",
          "maxThreads: nope",
          "maxThreads: 4\nunknown: 1"
        }) {
      assertThat(StrictYaml.parse("compute.yml", yaml, ComputeSettings.class))
          .matches(result -> result instanceof Result.Err<?, ?>);
    }
  }
}
