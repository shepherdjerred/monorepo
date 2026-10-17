package com.shepherdjerred.thestorm.safety.app;

import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.function.Consumer;
import java.util.function.Function;

/** Main-thread ingress: retain every event, with at most one activity database job in flight. */
public final class ActivityWrites implements AutoCloseable {
  private static final int BATCH_SIZE = 128;
  private final ArrayDeque<EvidenceStore.Observation> pending = new ArrayDeque<>();
  private final Function<List<EvidenceStore.Observation>, CompletableFuture<Void>> write;
  private final Scheduler scheduler;
  private final Consumer<Throwable> failures;
  private boolean scheduled;
  private boolean writing;
  private boolean closed;

  public ActivityWrites(
      Function<List<EvidenceStore.Observation>, CompletableFuture<Void>> write,
      Scheduler scheduler,
      Consumer<Throwable> failures) {
    this.write = write;
    this.scheduler = scheduler;
    this.failures = failures;
  }

  public synchronized void record(EvidenceStore.Observation observation) {
    if (closed) throw new IllegalStateException("Activity evidence writer is closed");
    pending.addLast(observation);
    schedule();
  }

  private void schedule() {
    if (closed || writing || scheduled || pending.isEmpty()) return;
    scheduled = true;
    scheduler.runOnMainThreadLater(Duration.ofMillis(50), this::flush);
  }

  private synchronized void flush() {
    scheduled = false;
    if (closed || writing || pending.isEmpty()) return;
    var batch = new ArrayList<EvidenceStore.Observation>();
    while (!pending.isEmpty() && batch.size() < BATCH_SIZE) batch.add(pending.removeFirst());
    writing = true;
    var _ = persist(List.copyOf(batch)).whenComplete((done, failure) -> completed(failure));
  }

  private synchronized void completed(@org.jspecify.annotations.Nullable Throwable failure) {
    writing = false;
    if (failure != null) failures.accept(failure);
    if (!closed) flush();
  }

  private CompletableFuture<Void> persist(List<EvidenceStore.Observation> batch) {
    try {
      return write.apply(batch);
    } catch (RuntimeException failure) {
      return CompletableFuture.failedFuture(failure);
    }
  }

  /** Queue remaining snapshots before the database owner drains and closes its writer. */
  @Override
  public synchronized void close() {
    if (closed) return;
    closed = true;
    if (pending.isEmpty()) return;
    var remaining = List.copyOf(pending);
    pending.clear();
    var _ =
        persist(remaining)
            .whenComplete(
                (done, failure) -> {
                  if (failure != null) failures.accept(failure);
                });
  }
}
