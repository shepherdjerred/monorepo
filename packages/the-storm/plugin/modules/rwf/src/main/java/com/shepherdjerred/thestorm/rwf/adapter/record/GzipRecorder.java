package com.shepherdjerred.thestorm.rwf.adapter.record;

import com.shepherdjerred.thestorm.core.compute.ComputePool;
import com.shepherdjerred.thestorm.rwf.app.MatchRecording;
import com.shepherdjerred.thestorm.rwf.app.Recorder;
import com.shepherdjerred.thestorm.rwf.app.RecordingSummary;
import com.shepherdjerred.thestorm.rwf.domain.record.Frame;
import com.shepherdjerred.thestorm.rwf.domain.record.InputFrame;
import com.shepherdjerred.thestorm.rwf.domain.record.Intent;
import com.shepherdjerred.thestorm.rwf.domain.record.ObservationFrame;
import com.shepherdjerred.thestorm.rwf.domain.record.Occurrence;
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
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.time.InstantSource;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.GZIPOutputStream;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;

/**
 * Writes each match to {@code <root>/yyyy/MM/dd/<matchId>.rwfrec.gz}: {@link RecordCodec} rows, one
 * per line, gzipped. The main thread only enqueues strings; one compute-pool task at a time drains
 * them to the file. While the match runs the file is {@code <matchId>.rwfrec.gz.part}; it is moved
 * to its final name atomically once the end row is written, so a {@code .rwfrec.gz} file is always
 * a finished recording and archiving never reads one still being written.
 *
 * <p>No row is dropped while the writer merely lags: the per-tick samples (frames, inputs and
 * observations) wait in an unbounded queue, and {@link Alarms#backlog} is raised whenever the
 * backlog crosses {@link #BACKLOG_WARNING}. Only past {@link #SAMPLE_CAP}, far beyond any match and
 * kept purely so a stalled disk cannot exhaust the heap, are new samples dropped, each raising
 * {@link Alarms#dropped}, and the count is reported in the summary.
 */
public final class GzipRecorder implements Recorder {

  /** Waiting samples above which the backlog is reported: about ten seconds of 100 combatants. */
  public static final int BACKLOG_WARNING = 20_000;

  /** Waiting samples beyond which new ones are dropped; only a stalled disk ever reaches it. */
  public static final int SAMPLE_CAP = 2_000_000;

  static final String SUFFIX = ".rwfrec.gz";

  /** A recording still being written; never archived and never pruned. */
  static final String PART_SUFFIX = SUFFIX + ".part";

  private static final DateTimeFormatter DAY_FOLDER =
      DateTimeFormatter.ofPattern("yyyy/MM/dd").withZone(ZoneOffset.UTC);

  /**
   * Where the recorder reports trouble. The production alarms log: a warning for a backlog, an
   * error for every drop, so a dropped frame is never silent.
   */
  public interface Alarms {

    /** {@code file}'s writer is {@code waiting} samples behind. */
    void backlog(Path file, int waiting);

    /** {@code file} has dropped {@code total} samples so far; the newest was just dropped. */
    void dropped(Path file, int total);

    /** {@code file} finished with {@code total} dropped samples (more than zero). */
    void finishedWithDrops(Path file, int total);

    /** Alarms that log to {@code logger}. */
    static Alarms logging(Logger logger) {
      return new Alarms() {
        @Override
        public void backlog(Path file, int waiting) {
          logger.warn(
              "rwf recording {} is {} samples behind; the writer is not keeping up", file, waiting);
        }

        @Override
        public void dropped(Path file, int total) {
          logger.error(
              "rwf recording {} dropped a sample: the writer is stalled past its cap ({} dropped"
                  + " so far)",
              file,
              total);
        }

        @Override
        public void finishedWithDrops(Path file, int total) {
          logger.error(
              "rwf_recording_dropped_frames={} for {}: the recording is incomplete", total, file);
        }
      };
    }
  }

  private final Path root;
  private final Path dataDirectory;
  private final ComputePool compute;
  private final InstantSource time;
  private final Alarms alarms;
  private final int sampleCap;
  private final List<Recording> open = new ArrayList<>();

  /**
   * What the writer runs with.
   *
   * @param compute the pool the writer runs on
   * @param time stamps the day folder
   * @param alarms where a backlog and dropped samples are reported
   */
  public record Parts(ComputePool compute, InstantSource time, Alarms alarms) {}

  /**
   * @param dataDirectory the plugin data folder, which file names in summaries are relative to
   * @param directory the recordings folder under it
   * @param parts the pool, clock and alarms
   */
  public GzipRecorder(Path dataDirectory, String directory, Parts parts) {
    this(dataDirectory, directory, parts, SAMPLE_CAP);
  }

  /** As the public constructor, with a smaller sample cap so tests can reach it. */
  GzipRecorder(Path dataDirectory, String directory, Parts parts, int sampleCap) {
    this.dataDirectory = dataDirectory;
    this.root = dataDirectory.resolve(directory);
    this.compute = parts.compute();
    this.time = parts.time();
    this.alarms = parts.alarms();
    this.sampleCap = sampleCap;
  }

  /** Where recordings go. */
  public Path root() {
    return root;
  }

  @Override
  public MatchRecording begin(RecordHeader header) {
    var folder = root.resolve(DAY_FOLDER.format(time.instant()));
    var file = folder.resolve(header.matchId() + SUFFIX);
    var recording = new Recording(file, folder.resolve(header.matchId() + PART_SUFFIX));
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

    /** How often, in drops, a continuing drop is reported again after the first. */
    private static final int DROP_REPORT_EVERY = 1_000;

    private final Path file;
    private final Path part;
    private final ConcurrentLinkedQueue<String> rows = new ConcurrentLinkedQueue<>();
    private final ConcurrentLinkedQueue<String> samples = new ConcurrentLinkedQueue<>();
    private final AtomicInteger waiting = new AtomicInteger();
    private final AtomicBoolean behind = new AtomicBoolean();
    private final AtomicInteger dropped = new AtomicInteger();
    private final AtomicBoolean scheduled = new AtomicBoolean();
    private final AtomicBoolean ended = new AtomicBoolean();
    private final CompletableFuture<RecordingSummary> finished = new CompletableFuture<>();
    private @Nullable Writer writer;

    Recording(Path file, Path part) {
      this.file = file;
      this.part = part;
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

    @Override
    public void observation(ObservationFrame observation) {
      sample(RecordCodec.observation(observation));
    }

    @Override
    public void occurrence(Occurrence occurrence) {
      rows.add(RecordCodec.occurrence(occurrence));
      schedule();
    }

    private void sample(String row) {
      var queued = waiting.incrementAndGet();
      if (queued > sampleCap) {
        waiting.decrementAndGet();
        var total = dropped.incrementAndGet();
        if (total == 1 || total % DROP_REPORT_EVERY == 0) {
          alarms.dropped(file, total);
        }
      } else {
        samples.add(row);
        if (queued > BACKLOG_WARNING && behind.compareAndSet(false, true)) {
          alarms.backlog(file, queued);
        }
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
        // Rows first: the header row is queued before any sample, and readers need it before the
        // input and observation rows whose shape depends on its version.
        String row;
        while ((row = rows.poll()) != null) {
          out.write(row);
        }
        while ((row = samples.poll()) != null) {
          out.write(row);
          if (waiting.decrementAndGet() <= BACKLOG_WARNING / 2) {
            behind.set(false);
          }
        }
        if (ended.get() && rows.isEmpty() && samples.isEmpty()) {
          finish(out);
          return;
        }
      } catch (IOException | RuntimeException failure) {
        fail(failure);
        return;
      } finally {
        scheduled.set(false);
      }
      if (!rows.isEmpty() || !samples.isEmpty()) {
        schedule();
      }
    }

    private Writer writer() throws IOException {
      var current = writer;
      if (current == null) {
        Files.createDirectories(part.getParent());
        current =
            new BufferedWriter(
                new OutputStreamWriter(
                    new GZIPOutputStream(Files.newOutputStream(part)), StandardCharsets.UTF_8));
        writer = current;
      }
      return current;
    }

    private void finish(Writer out) throws IOException {
      out.close();
      writer = null;
      Files.move(part, file, StandardCopyOption.ATOMIC_MOVE);
      var size = Files.size(file);
      synchronized (open) {
        open.remove(this);
      }
      var lost = dropped.get();
      if (lost > 0) {
        alarms.finishedWithDrops(file, lost);
      }
      finished.complete(
          new RecordingSummary(Optional.of(dataDirectory.relativize(file).toString()), size, lost));
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
              ? new UncheckedIOException("could not write " + part, io)
              : failure);
    }
  }
}
