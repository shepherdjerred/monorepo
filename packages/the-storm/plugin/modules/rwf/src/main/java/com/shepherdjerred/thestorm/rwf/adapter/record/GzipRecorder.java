package com.shepherdjerred.thestorm.rwf.adapter.record;

import com.shepherdjerred.thestorm.core.compute.ComputePool;
import com.shepherdjerred.thestorm.rwf.app.MatchRecording;
import com.shepherdjerred.thestorm.rwf.app.Recorder;
import com.shepherdjerred.thestorm.rwf.app.RecordingSummary;
import com.shepherdjerred.thestorm.rwf.domain.record.Frame;
import com.shepherdjerred.thestorm.rwf.domain.record.InputFrame;
import com.shepherdjerred.thestorm.rwf.domain.record.Intent;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordCodec;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordEnd;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordEvent;
import com.shepherdjerred.thestorm.rwf.domain.record.RecordHeader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.UncheckedIOException;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.InstantSource;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.GZIPOutputStream;
import org.jspecify.annotations.Nullable;

/**
 * Writes each match to {@code <root>/yyyy/MM/dd/<matchId>.rwfrec.gz}: {@link RecordCodec} rows, one
 * per line, gzipped. The main thread only enqueues strings; one compute-pool task at a time drains
 * them to the file. Header, event, intent and end rows are never dropped; the per-tick samples
 * (frames and human inputs) are dropped and counted when the writer falls more than {@link
 * #FRAME_CAPACITY} samples behind.
 */
public final class GzipRecorder implements Recorder {

  /** The most samples (frames and inputs) waiting to be written before new ones are dropped. */
  public static final int FRAME_CAPACITY = 20_000;

  static final String SUFFIX = ".rwfrec.gz";

  private static final DateTimeFormatter DAY_FOLDER =
      DateTimeFormatter.ofPattern("yyyy/MM/dd").withZone(ZoneOffset.UTC);

  private final Path root;
  private final Path dataDirectory;
  private final ComputePool compute;
  private final InstantSource time;
  private final List<Recording> open = new ArrayList<>();

  /**
   * @param dataDirectory the plugin data folder, which file names in summaries are relative to
   * @param directory the recordings folder under it
   * @param compute the pool the writer runs on
   * @param time stamps the day folder
   */
  public GzipRecorder(
      Path dataDirectory, String directory, ComputePool compute, InstantSource time) {
    this.dataDirectory = dataDirectory;
    this.root = dataDirectory.resolve(directory);
    this.compute = compute;
    this.time = time;
  }

  /** Where recordings go. */
  public Path root() {
    return root;
  }

  @Override
  public MatchRecording begin(RecordHeader header) {
    var folder = root.resolve(DAY_FOLDER.format(time.instant()));
    var file = folder.resolve(header.matchId() + SUFFIX);
    var recording = new Recording(file);
    synchronized (open) {
      open.add(recording);
    }
    recording.rows.add(RecordCodec.header(header));
    recording.schedule();
    return recording;
  }

  @Override
  public CompletableFuture<Void> close(Duration timeout) {
    List<Recording> pending;
    synchronized (open) {
      pending = List.copyOf(open);
    }
    var all =
        pending.stream().map(recording -> recording.finished).toArray(CompletableFuture[]::new);
    return CompletableFuture.allOf(all).orTimeout(timeout.toMillis(), TimeUnit.MILLISECONDS);
  }

  /** One match's file and its queues. */
  private final class Recording implements MatchRecording {

    private final Path file;
    private final ConcurrentLinkedQueue<String> rows = new ConcurrentLinkedQueue<>();
    private final ArrayBlockingQueue<String> frames = new ArrayBlockingQueue<>(FRAME_CAPACITY);
    private final AtomicInteger dropped = new AtomicInteger();
    private final AtomicBoolean scheduled = new AtomicBoolean();
    private final AtomicBoolean ended = new AtomicBoolean();
    private final CompletableFuture<RecordingSummary> finished = new CompletableFuture<>();
    private @Nullable Writer writer;

    Recording(Path file) {
      this.file = file;
    }

    @Override
    public void event(RecordEvent event) {
      rows.add(RecordCodec.event(event));
      schedule();
    }

    @Override
    public void frame(Frame frame) {
      sample(RecordCodec.frame(frame));
    }

    @Override
    public void input(InputFrame input) {
      sample(RecordCodec.input(input));
    }

    private void sample(String row) {
      if (!frames.offer(row)) {
        dropped.incrementAndGet();
      }
      schedule();
    }

    @Override
    public void intent(Intent intent) {
      rows.add(RecordCodec.intent(intent));
      schedule();
    }

    @Override
    public CompletableFuture<RecordingSummary> end(RecordEnd end) {
      if (ended.compareAndSet(false, true)) {
        rows.add(RecordCodec.end(end));
        schedule();
      }
      return finished;
    }

    /** Runs the drain on the pool unless one is already running or queued. */
    void schedule() {
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
        String row;
        while ((row = rows.poll()) != null) {
          out.write(row);
        }
        while ((row = frames.poll()) != null) {
          out.write(row);
        }
        if (ended.get() && rows.isEmpty()) {
          finish(out);
          return;
        }
      } catch (IOException | RuntimeException failure) {
        fail(failure);
        return;
      } finally {
        scheduled.set(false);
      }
      if (!rows.isEmpty() || !frames.isEmpty()) {
        schedule();
      }
    }

    private Writer writer() throws IOException {
      var current = writer;
      if (current == null) {
        Files.createDirectories(file.getParent());
        current =
            new BufferedWriter(
                new OutputStreamWriter(
                    new GZIPOutputStream(Files.newOutputStream(file)), StandardCharsets.UTF_8));
        writer = current;
      }
      return current;
    }

    private void finish(Writer out) throws IOException {
      out.close();
      writer = null;
      var size = Files.size(file);
      synchronized (open) {
        open.remove(this);
      }
      finished.complete(
          new RecordingSummary(
              Optional.of(dataDirectory.relativize(file).toString()), size, dropped.get()));
    }

    private void fail(Exception failure) {
      var current = writer;
      writer = null;
      if (current != null) {
        try {
          current.close();
        } catch (IOException ignored) {
          // The write already failed; the original failure is reported.
        }
      }
      synchronized (open) {
        open.remove(this);
      }
      finished.completeExceptionally(
          failure instanceof IOException io
              ? new UncheckedIOException("could not write " + file, io)
              : failure);
    }
  }
}
