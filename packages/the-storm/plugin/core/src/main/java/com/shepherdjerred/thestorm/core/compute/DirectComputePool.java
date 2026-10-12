package com.shepherdjerred.thestorm.core.compute;

import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Runs compute work on the calling thread, immediately. For tests and harnesses, where work must be
 * finished when the submitting call returns and no thread pool should outlive the test. Never hand
 * this to a production module: it would run "off-thread" work on the server tick.
 */
public final class DirectComputePool implements ComputePool {

  private final AtomicBoolean closed = new AtomicBoolean();

  @Override
  public Executor executor() {
    return task -> {
      if (closed.get()) {
        throw new RejectedExecutionException("the compute pool is closed");
      }
      task.run();
    };
  }

  @Override
  public void close() {
    closed.set(true);
  }

  /** Whether {@link #close} has been called. */
  public boolean isClosed() {
    return closed.get();
  }
}
