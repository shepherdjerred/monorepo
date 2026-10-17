package com.shepherdjerred.thestorm.rwfbots.app;

import java.lang.management.ManagementFactory;
import java.lang.management.ThreadMXBean;
import java.util.function.LongSupplier;
import java.util.function.Supplier;
import jdk.jfr.Category;
import jdk.jfr.Event;
import jdk.jfr.EventType;
import jdk.jfr.Label;
import jdk.jfr.Name;
import jdk.jfr.StackTrace;
import jdk.jfr.Timespan;
import org.jspecify.annotations.Nullable;

/** Opt-in Flight Recorder spans; disabled recordings allocate no per-stage diagnostic objects. */
final class ThinkFlight {
  private static final EventType TYPE = EventType.getEventType(Span.class);
  private static final ThreadMXBean THREADS = ManagementFactory.getThreadMXBean();
  private static final Task NONE = new Task(null, () -> 0);

  private ThinkFlight() {}

  record Context(String stage, int generation, long tick, LongSupplier clock) {}

  static @Nullable Context context(String stage, int generation, long tick, LongSupplier clock) {
    return TYPE.isEnabled() ? new Context(stage, generation, tick, clock) : null;
  }

  static Task queued(@Nullable Context context, int batch, int inputs) {
    if (context == null || !TYPE.isEnabled()) return NONE;
    var event = new Span();
    event.stage = context.stage();
    event.generation = context.generation();
    event.tick = context.tick();
    event.batch = batch;
    event.inputs = inputs;
    event.begin();
    return new Task(event, context.clock());
  }

  static Task section(@Nullable Context context, int inputs) {
    var task = queued(context, -1, inputs);
    task.enter();
    return task;
  }

  /** A single bot's work, nested inside its stage batch when recordings are enabled. */
  static Task bot(@Nullable Context context, int botId) {
    var task = section(context, 1);
    if (task.span != null) task.span.botId = botId;
    return task;
  }

  @Category({"Red Warfare", "The Storm"})
  @Label("Bot thinking span")
  @Name("storm.BotThink")
  @StackTrace(false)
  static final class Span extends Event {
    String stage = "";
    int generation;
    long tick;
    int batch;
    int inputs;
    int botId = -1;
    @Timespan long queueNanos;
    @Timespan long workerNanos;
    @Timespan long cpuNanos;
  }

  static final class Task implements AutoCloseable {
    private final @Nullable Span span;
    private final LongSupplier clock;
    private final long queuedAt;
    private long enteredAt;
    private long cpuAt;

    private Task(@Nullable Span span, LongSupplier clock) {
      this.span = span;
      this.clock = clock;
      queuedAt = span == null ? 0 : clock.getAsLong();
    }

    void tick(long tick) {
      if (span != null) span.tick = tick;
    }

    void input() {
      if (span != null) span.inputs++;
    }

    void enter() {
      if (span == null) return;
      enteredAt = clock.getAsLong();
      span.queueNanos = enteredAt - queuedAt;
      cpuAt = cpuTime();
    }

    <T> T measure(Supplier<T> operation) {
      enter();
      try {
        return operation.get();
      } finally {
        close();
      }
    }

    private long cpuTime() {
      // A cycle crosses worker threads; its aggregate CPU cannot use a thread-local counter.
      if (span == null || span.stage.equals("cycle") || !THREADS.isThreadCpuTimeEnabled())
        return -1;
      return THREADS.getCurrentThreadCpuTime();
    }

    @Override
    public void close() {
      if (span == null) return;
      span.workerNanos = clock.getAsLong() - enteredAt;
      var cpu = cpuTime();
      span.cpuNanos = cpuAt < 0 || cpu < 0 ? -1 : cpu - cpuAt;
      span.end();
      span.commit();
    }
  }
}
