package com.shepherdjerred.thestorm.tracks.app;

import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;

/** Runs "main thread" work on the calling thread; delayed tasks wait until a test runs them. */
public final class FakeScheduler implements Scheduler {

  /** A delayed task and its delay. */
  public record Delayed(Duration delay, Runnable task) {}

  private final List<Delayed> delayed = new ArrayList<>();

  @Override
  public void runOnMainThread(Runnable task) {
    task.run();
  }

  @Override
  public synchronized Cancellable runOnMainThreadLater(Duration delay, Runnable task) {
    var entry = new Delayed(delay, task);
    delayed.add(entry);
    return () -> removeDelayed(entry);
  }

  @Override
  public Cancellable repeatOnMainThread(Duration delay, Duration period, Runnable task) {
    throw new UnsupportedOperationException("the tracks never repeat work");
  }

  @Override
  public Executor mainThread() {
    return Runnable::run;
  }

  /** The delays of the tasks waiting to run. */
  public synchronized List<Duration> pendingDelays() {
    return delayed.stream().map(Delayed::delay).toList();
  }

  /** Runs every waiting task once, as if their delays had passed. */
  public void runDelayed() {
    List<Delayed> due;
    synchronized (this) {
      due = List.copyOf(delayed);
      delayed.clear();
    }
    due.forEach(entry -> entry.task().run());
  }

  private synchronized void removeDelayed(Delayed entry) {
    delayed.remove(entry);
  }
}
