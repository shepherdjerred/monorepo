package com.shepherdjerred.thestorm.core.snapshot;

import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import java.time.Duration;
import java.util.ArrayDeque;

/**
 * Spaces out work that writes a player file on the main thread, server-wide: the first piece runs
 * at once, and every later one a tick after the one before. Restores in several games ending in the
 * same tick write their files over as many ticks, not all at once. Main thread only.
 */
public final class SavePacer {

  /** The space between two writes: one server tick. */
  public static final Duration SPACING = Duration.ofMillis(50);

  private final Scheduler scheduler;
  private final ArrayDeque<Runnable> waiting = new ArrayDeque<>();
  private boolean busy;

  public SavePacer(Scheduler scheduler) {
    this.scheduler = scheduler;
  }

  /** Runs {@code write} now if nothing has written this tick, else in its turn, one a tick. */
  public void submit(Runnable write) {
    waiting.add(write);
    if (!busy) {
      busy = true;
      next();
    }
  }

  private void next() {
    var write = waiting.poll();
    if (write == null) {
      busy = false;
      return;
    }
    try {
      write.run();
    } finally {
      // This tick's write is spent: the next one, queued now or later this tick, waits a tick.
      var _ = scheduler.runOnMainThreadLater(SPACING, this::next);
    }
  }
}
