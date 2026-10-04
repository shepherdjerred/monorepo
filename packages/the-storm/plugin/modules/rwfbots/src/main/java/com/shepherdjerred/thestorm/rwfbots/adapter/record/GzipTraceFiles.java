package com.shepherdjerred.thestorm.rwfbots.adapter.record;

import com.shepherdjerred.thestorm.core.compute.ComputePool;
import com.shepherdjerred.thestorm.rwfbots.app.TraceSink;
import com.shepherdjerred.thestorm.rwfbots.domain.record.DecisionTrace;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.UncheckedIOException;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.GZIPOutputStream;
import org.jspecify.annotations.Nullable;

/**
 * Writes each match's decision traces to {@code <dataDirectory>/<directory>/<matchId>.gz}, one
 * {@link TraceLines} row per line. Think jobs only enqueue; one compute-pool task at a time drains
 * the queue to the file. The queue is bounded: when the writer falls behind, new lines are dropped
 * and counted rather than held in memory. {@link #record} before {@link #begin} or after {@link
 * #end} is counted as dropped too.
 */
public final class GzipTraceFiles implements TraceSink {

  static final String SUFFIX = ".gz";

  private final Path root;
  private final ComputePool compute;
  private final int capacity;
  private volatile @Nullable Recording current;

  /**
   * @param dataDirectory the plugin data folder
   * @param directory the traces folder under it
   * @param compute the pool the writer runs on
   * @param capacity how many lines may wait before new ones are dropped
   */
  public GzipTraceFiles(Path dataDirectory, String directory, ComputePool compute, int capacity) {
    if (capacity < 1) {
      throw new IllegalArgumentException("capacity must be positive");
    }
    this.root = dataDirectory.resolve(directory);
    this.compute = compute;
    this.capacity = capacity;
  }

  public Path root() {
    return root;
  }

  /**
   * Starts the file for {@code matchId}; an open recording is ended first and its outcome returned
   * (completed at once with zero when nothing was open).
   */
  public CompletableFuture<Integer> begin(UUID matchId) {
    var previous = end();
    current = new Recording(root.resolve(matchId + SUFFIX));
    return previous;
  }

  /**
   * Closes the open recording, if any; the future completes with how many lines were dropped, or
   * exceptionally if the file could not be written. Completed at once when nothing was open.
   */
  public CompletableFuture<Integer> end() {
    var recording = current;
    current = null;
    if (recording == null) {
      return CompletableFuture.completedFuture(0);
    }
    return recording.end();
  }

  /** How many lines the open recording has dropped so far. */
  public int dropped() {
    var recording = current;
    return recording == null ? 0 : recording.dropped.get();
  }

  @Override
  public void record(DecisionTrace trace, Decision decision) {
    var recording = current;
    if (recording == null) {
      return;
    }
    recording.offer(TraceLines.decision(trace, decision));
  }

  /** One match's file and queue. */
  private final class Recording {

    private final Path file;
    private final ArrayBlockingQueue<String> lines = new ArrayBlockingQueue<>(capacity);
    private final AtomicInteger dropped = new AtomicInteger();
    private final AtomicBoolean scheduled = new AtomicBoolean();
    private final AtomicBoolean ended = new AtomicBoolean();
    private final CompletableFuture<Integer> finished = new CompletableFuture<>();
    private @Nullable Writer writer;

    Recording(Path file) {
      this.file = file;
    }

    void offer(String line) {
      if (ended.get() || !lines.offer(line)) {
        dropped.incrementAndGet();
        return;
      }
      schedule();
    }

    CompletableFuture<Integer> end() {
      if (ended.compareAndSet(false, true)) {
        schedule();
      }
      return finished;
    }

    private void schedule() {
      if (scheduled.compareAndSet(false, true)) {
        try {
          compute.executor().execute(this::drain);
        } catch (RuntimeException rejected) {
          scheduled.set(false);
          finished.completeExceptionally(rejected);
        }
      }
    }

    private synchronized void drain() {
      try {
        var out = writer();
        String line;
        while ((line = lines.poll()) != null) {
          out.write(line);
        }
        if (ended.get() && lines.isEmpty()) {
          out.close();
          writer = null;
          finished.complete(dropped.get());
          return;
        }
      } catch (IOException | RuntimeException failure) {
        fail(failure);
        return;
      } finally {
        scheduled.set(false);
      }
      if (!lines.isEmpty() || ended.get()) {
        schedule();
      }
    }

    private Writer writer() throws IOException {
      var open = writer;
      if (open == null) {
        Files.createDirectories(file.getParent());
        open =
            new BufferedWriter(
                new OutputStreamWriter(
                    new GZIPOutputStream(Files.newOutputStream(file)), StandardCharsets.UTF_8));
        writer = open;
      }
      return open;
    }

    private void fail(Exception failure) {
      var open = writer;
      writer = null;
      if (open != null) {
        try {
          open.close();
        } catch (IOException ignored) {
          // The write already failed; the original failure is what gets reported.
        }
      }
      ended.set(true);
      finished.completeExceptionally(
          failure instanceof IOException io
              ? new UncheckedIOException("could not write " + file, io)
              : failure);
    }
  }
}
