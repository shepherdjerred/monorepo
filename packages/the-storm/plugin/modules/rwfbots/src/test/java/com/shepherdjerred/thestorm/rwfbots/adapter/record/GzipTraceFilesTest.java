package com.shepherdjerred.thestorm.rwfbots.adapter.record;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.compute.ComputePool;
import com.shepherdjerred.thestorm.core.compute.DirectComputePool;
import com.shepherdjerred.thestorm.rwfbots.domain.record.DecisionTrace;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executor;
import java.util.zip.GZIPInputStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Traces land in one gzipped file per match, and a full queue drops and counts. */
final class GzipTraceFilesTest {

  private static final UUID MATCH = UUID.fromString("00000000-0000-0000-0000-0000000000ff");
  private static final CombatantId BOT = new CombatantId(4);

  @TempDir Path directory;

  private static DecisionTrace trace(long tick) {
    return new DecisionTrace(
        BOT,
        tick,
        List.of(new DecisionTrace.Feature("health", 7), new DecisionTrace.Feature("enemies", 2)),
        List.of(
            new DecisionTrace.ScoredOption(Option.ENGAGE, 0.75),
            new DecisionTrace.ScoredOption(Option.ARM, 0.5)),
        Option.ENGAGE,
        0.25,
        0.125);
  }

  private static String read(Path file) throws IOException {
    try (var in = new GZIPInputStream(Files.newInputStream(file))) {
      return new String(in.readAllBytes(), StandardCharsets.UTF_8);
    }
  }

  @Test
  void linesAreWrittenToTheMatchFileAndTheFileClosesOnEnd() throws IOException {
    var files = new GzipTraceFiles(directory, "rwfbots-traces", new DirectComputePool(), 100);
    var _ = files.begin(MATCH);
    files.record(trace(10), Decision.idle(BOT, 10, 0));
    files.record(trace(15), Decision.idle(BOT, 15, 1));

    assertThat(files.end().join()).isZero();

    var file = directory.resolve("rwfbots-traces").resolve(MATCH + ".gz");
    var text = read(file);
    assertThat(text.lines()).hasSize(2);
    assertThat(text.lines().findFirst().orElseThrow())
        .isEqualTo(
            "decision\t10\t4\t0\tENGAGE\tidle\t0.2500\t0.1250\thealth=7,enemies=2\tENGAGE=0.7500,ARM=0.5000\t0");
    assertThat(text.lines().skip(1).findFirst().orElseThrow()).startsWith("decision\t15\t4\t1\t");
  }

  @Test
  void aFullQueueDropsAndCountsAndNothingIsWrittenOutsideAMatch() {
    var queued = new ArrayDeque<Runnable>();
    ComputePool stalled =
        new ComputePool() {
          @Override
          public Executor executor() {
            return queued::add;
          }

          @Override
          public void close() {}
        };
    var files = new GzipTraceFiles(directory, "traces", stalled, 2);
    files.record(trace(1), Decision.idle(BOT, 1, 0));
    assertThat(files.dropped()).as("no match open").isZero();

    var _ = files.begin(MATCH);
    for (var tick = 1; tick <= 5; tick++) {
      files.record(trace(tick), Decision.idle(BOT, tick, 0));
    }
    assertThat(files.dropped()).isEqualTo(3);

    var ended = files.end();
    queued.forEach(Runnable::run);
    assertThat(ended.join()).isEqualTo(3);
    assertThat(directory.resolve("traces").resolve(MATCH + ".gz")).exists();
  }
}
