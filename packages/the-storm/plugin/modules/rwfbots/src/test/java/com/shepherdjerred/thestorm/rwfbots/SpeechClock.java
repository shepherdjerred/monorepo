package com.shepherdjerred.thestorm.rwfbots;

import com.shepherdjerred.thestorm.core.schedule.Cancellable;
import com.shepherdjerred.thestorm.core.schedule.Scheduler;
import java.time.Duration;
import java.time.Instant;
import java.time.InstantSource;
import java.util.Optional;
import java.util.concurrent.Executor;

/** Drives the real speech timer without advancing autonomous movement in speech fixtures. */
final class SpeechClock implements Scheduler {
  private final InstantSource time;
  private Optional<Runnable> callback = Optional.empty();
  private Instant next = Instant.MAX;
  private Duration period = Duration.ZERO;

  SpeechClock(InstantSource time) {
    this.time = time;
  }

  @Override
  public void runOnMainThread(Runnable task) {
    task.run();
  }

  @Override
  public Cancellable runOnMainThreadLater(Duration delay, Runnable task) {
    throw new UnsupportedOperationException("Speech fixture has no delayed tasks");
  }

  @Override
  public Cancellable repeatOnMainThread(Duration delay, Duration every, Runnable task) {
    if (callback.isPresent() || every.isZero() || every.isNegative()) {
      throw new IllegalStateException("Speech fixture requires one repeating clock");
    }
    callback = Optional.of(task);
    next = time.instant().plus(delay);
    period = every;
    return () -> callback = Optional.empty();
  }

  @Override
  public Executor mainThread() {
    return this::runOnMainThread;
  }

  void pulse() {
    if (time.instant().isBefore(next)) {
      throw new IllegalStateException("Speech timer is not due");
    }
    next = time.instant().plus(period);
    callback.orElseThrow().run();
  }
}
