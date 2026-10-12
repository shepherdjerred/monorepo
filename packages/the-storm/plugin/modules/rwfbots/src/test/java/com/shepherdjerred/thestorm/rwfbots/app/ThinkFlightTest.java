package com.shepherdjerred.thestorm.rwfbots.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.compute.ComputePool;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.List;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicLong;
import jdk.jfr.Recording;
import jdk.jfr.consumer.RecordingFile;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

final class ThinkFlightTest {
  @Test
  void recordsQueueAndWorkForSuccessfulAndFailedBatches(@TempDir Path directory) throws Exception {
    var queue = new ArrayDeque<Runnable>();
    ComputePool pool =
        new ComputePool() {
          @Override
          public Executor executor() {
            return queue::add;
          }

          @Override
          public int parallelism() {
            return 2;
          }

          @Override
          public void close() {}
        };
    var clock = new AtomicLong();
    var file = directory.resolve("batches.jfr");
    try (var recording = new Recording()) {
      recording.enable(ThinkFlight.Span.class);
      recording.start();
      var context = ThinkFlight.context("tactics", 7, 42, clock::get);
      var result =
          new ThinkBatches(pool)
              .map(
                  context,
                  List.of(0, 1),
                  input -> {
                    clock.addAndGet(7_000_000);
                    if (input == 0) throw new IllegalStateException("failed batch");
                    return input;
                  });
      clock.set(15_000_000);
      queue.removeFirst().run();
      assertThat(result.isDone()).isFalse();
      queue.removeFirst().run();
      assertThat(result.isCompletedExceptionally()).isTrue();
      recording.stop();
      recording.dump(file);
    }
    var spans =
        RecordingFile.readAllEvents(file).stream()
            .filter(event -> event.getEventType().getName().equals("storm.BotThink"))
            .toList();
    assertThat(spans).hasSize(2);
    assertThat(spans)
        .allSatisfy(
            event -> {
              assertThat(event.getString("stage")).isEqualTo("tactics");
              assertThat(event.getInt("generation")).isEqualTo(7);
              assertThat(event.getLong("tick")).isEqualTo(42);
              assertThat(event.getInt("inputs")).isEqualTo(1);
              assertThat(event.getLong("workerNanos")).isEqualTo(7_000_000);
              assertThat(event.getLong("cpuNanos")).isGreaterThanOrEqualTo(-1);
            });
    assertThat(spans.stream().map(event -> event.getLong("queueNanos")))
        .containsExactlyInAnyOrder(15_000_000L, 22_000_000L);
  }

  @Test
  void disabledRecordingDoesNotReadTheClock() {
    var reads = new AtomicLong();
    var context = ThinkFlight.context("cycle", 1, 1, reads::incrementAndGet);
    var trace = ThinkFlight.section(context, 1);
    trace.close();
    assertThat(reads).hasValue(0);
  }
}
