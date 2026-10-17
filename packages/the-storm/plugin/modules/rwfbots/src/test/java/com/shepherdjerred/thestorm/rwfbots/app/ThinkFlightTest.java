package com.shepherdjerred.thestorm.rwfbots.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.compute.ComputePool;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.List;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.BiFunction;
import jdk.jfr.Recording;
import jdk.jfr.consumer.RecordingFile;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

final class ThinkFlightTest {
  @ParameterizedTest
  @ValueSource(booleans = {false, true})
  void recordsQueueAndWorkForSuccessfulAndFailedBatches(boolean balanced, @TempDir Path directory)
      throws Exception {
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
      BiFunction<Integer, Integer, Integer> operation =
          (workspace, input) -> {
            clock.addAndGet(7_000_000);
            if (input == 0) throw new IllegalStateException("failed batch");
            return input;
          };
      var batches = new ThinkBatches(pool);
      var result =
          balanced
              ? batches.balanced(context, List.of(0, 1, 2), operation)
              : batches.indexed(context, List.of(0, 1), operation);
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
              assertThat(event.getInt("botId")).isEqualTo(-1);
              assertThat(event.getLong("workerNanos"))
                  .isEqualTo(event.getInt("inputs") * 7_000_000L);
              assertThat(event.getLong("cpuNanos")).isGreaterThanOrEqualTo(-1);
            });
    assertThat(spans.stream().map(event -> event.getLong("queueNanos")))
        .containsExactlyInAnyOrder(15_000_000L, 22_000_000L);
    assertThat(spans.stream().map(event -> event.getInt("inputs")))
        .containsExactlyInAnyOrderElementsOf(balanced ? List.of(1, 2) : List.of(1, 1));
  }

  @Test
  void identifiesSuccessfulAndFailedBotWork(@TempDir Path directory) throws Exception {
    var clock = new AtomicLong();
    var file = directory.resolve("bots.jfr");
    try (var recording = new Recording()) {
      recording.enable(ThinkFlight.Span.class);
      recording.start();
      var context = ThinkFlight.context("tactics-bot", 7, 42, clock::get);
      var success = ThinkFlight.bot(context, 3);
      clock.addAndGet(7_000_000);
      success.close();
      assertThatThrownBy(
              () -> {
                var failed = ThinkFlight.bot(context, 8);
                try {
                  clock.addAndGet(9_000_000);
                  throw new IllegalStateException("failed bot work");
                } finally {
                  failed.close();
                }
              })
          .isInstanceOf(IllegalStateException.class)
          .hasMessage("failed bot work");
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
              assertThat(event.getString("stage")).isEqualTo("tactics-bot");
              assertThat(event.getInt("generation")).isEqualTo(7);
              assertThat(event.getLong("tick")).isEqualTo(42);
              assertThat(event.getInt("inputs")).isEqualTo(1);
              assertThat(event.getLong("queueNanos")).isZero();
              assertThat(event.getLong("cpuNanos")).isGreaterThanOrEqualTo(-1);
            });
    assertThat(spans.stream().map(event -> event.getInt("botId"))).containsExactlyInAnyOrder(3, 8);
    assertThat(spans.stream().map(event -> event.getLong("workerNanos")))
        .containsExactlyInAnyOrder(7_000_000L, 9_000_000L);
  }

  @Test
  void disabledRecordingDoesNotReadTheClock() {
    var reads = new AtomicLong();
    var context = ThinkFlight.context("cycle", 1, 1, reads::incrementAndGet);
    var trace = ThinkFlight.section(context, 1);
    trace.input();
    trace.close();
    ThinkFlight.bot(context, 3).close();
    assertThat(context).isNull();
    assertThat(reads).hasValue(0);
  }
}
