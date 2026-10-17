package com.shepherdjerred.thestorm.safety.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.safety.ContentSubmission;
import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import org.junit.jupiter.api.Test;

final class ActivityWritesTest {
  private final ArrayDeque<Runnable> tasks = new ArrayDeque<>();
  private final ArrayDeque<CompletableFuture<Void>> completions = new ArrayDeque<>();
  private final List<List<EvidenceStore.Observation>> batches = new ArrayList<>();
  private final List<Throwable> failures = new ArrayList<>();
  private final Scheduler scheduler =
      new Scheduler() {
        @Override
        public void runOnMainThread(Runnable task) {
          tasks.add(task);
        }

        @Override
        public Cancellable runOnMainThreadLater(Duration delay, Runnable task) {
          assertThat(delay).isEqualTo(Duration.ofMillis(50));
          tasks.add(task);
          return () -> {};
        }

        @Override
        public Cancellable repeatOnMainThread(Duration delay, Duration period, Runnable task) {
          throw new UnsupportedOperationException();
        }

        @Override
        public Executor mainThread() {
          return tasks::add;
        }
      };
  private final ActivityWrites writes =
      new ActivityWrites(
          batch -> {
            batches.add(batch);
            var completion = new CompletableFuture<Void>();
            completions.add(completion);
            return completion;
          },
          scheduler,
          failures::add);

  private static EvidenceStore.Observation observation(int index) {
    return new EvidenceStore.Observation(
        new ContentSubmission(
            new UUID(2, index),
            new UUID(1, 1),
            "Alice",
            "activity",
            "staff",
            "click " + index,
            "",
            "chest"),
        index % 2 == 0 ? "observed" : "denied",
        Instant.EPOCH.plusMillis(index));
  }

  private void runTasks() {
    while (!tasks.isEmpty()) tasks.removeFirst().run();
  }

  @Test
  void burstRetainsEverySnapshotAndOnlyQueuesOneBoundedDatabaseBatch() {
    var expected = new ArrayList<EvidenceStore.Observation>();
    for (int index = 0; index < 10000; index++) {
      var event = observation(index);
      expected.add(event);
      writes.record(event);
    }
    assertThat(tasks).hasSize(1);
    assertThat(batches).isEmpty();
    runTasks();
    assertThat(batches).hasSize(1);
    assertThat(completions).hasSize(1);
    assertThat(tasks).isEmpty();
    while (!completions.isEmpty()) {
      completions.removeFirst().complete(null);
      runTasks();
      assertThat(completions.size()).isLessThanOrEqualTo(1);
    }
    assertThat(batches).allSatisfy(batch -> assertThat(batch.size()).isLessThanOrEqualTo(128));
    assertThat(batches.stream().flatMap(List::stream).toList()).containsExactlyElementsOf(expected);
    assertThat(failures).isEmpty();
  }

  @Test
  void failuresAreObservedAndDoNotStopLaterActivity() {
    writes.record(observation(1));
    runTasks();
    completions.removeFirst().completeExceptionally(new IllegalStateException("storage failed"));
    runTasks();
    assertThat(failures).hasSize(1);
    writes.record(observation(2));
    runTasks();
    assertThat(batches).hasSize(2);
    assertThat(batches.getLast()).containsExactly(observation(2));
  }

  @Test
  void shutdownQueuesEveryRemainingSnapshotBeforeTheDatabaseCloses() {
    for (int index = 0; index < 300; index++) writes.record(observation(index));
    runTasks();
    assertThat(batches).hasSize(1);
    writes.close();
    assertThat(batches).hasSize(2);
    assertThat(batches.stream().mapToInt(List::size).sum()).isEqualTo(300);
    completions.removeFirst().complete(null);
    runTasks();
    writes.close();
    assertThat(batches).hasSize(2);
  }
}
