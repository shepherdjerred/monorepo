package com.shepherdjerred.thestorm.core.snapshot;

import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import java.time.Duration;
import java.util.Comparator;
import java.util.PriorityQueue;
import java.util.concurrent.Executor;

/**
 * A main thread the test drives by hand: tasks run only when {@link #runFor} reaches them, so a
 * keeper abandoned mid-flight (a crash) never runs another callback.
 */
final class ManualScheduler implements Scheduler {

  private record Task(Duration due, long order, Runnable work) {}

  private final PriorityQueue<Task> tasks =
      new PriorityQueue<>(Comparator.comparing(Task::due).thenComparingLong(Task::order));
  private Duration now = Duration.ZERO;
  private long order;

  @Override
  public void runOnMainThread(Runnable task) {
    tasks.add(new Task(now, order++, task));
  }

  @Override
  public Cancellable runOnMainThreadLater(Duration delay, Runnable task) {
    var scheduled = new Task(now.plus(delay), order++, task);
    tasks.add(scheduled);
    return () -> tasks.remove(scheduled);
  }

  @Override
  public Cancellable repeatOnMainThread(Duration delay, Duration period, Runnable task) {
    throw new UnsupportedOperationException("the keeper never repeats work");
  }

  @Override
  public Executor mainThread() {
    return this::runOnMainThread;
  }

  /** Runs every task due within {@code duration} from now, in order, including ones they add. */
  void runFor(Duration duration) {
    var until = now.plus(duration);
    while (!tasks.isEmpty() && tasks.peek().due().compareTo(until) <= 0) {
      var next = tasks.poll();
      now = next.due();
      next.work().run();
    }
    now = until;
  }

  /** Runs everything due now. */
  void settle() {
    runFor(Duration.ZERO);
  }
}
