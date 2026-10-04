package com.shepherdjerred.castlecasters.engine;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.function.Supplier;

/** Cross-thread requests execute only on the GL/game thread. */
public final class LoopControl {
  private final ConcurrentLinkedQueue<Runnable> requests = new ConcurrentLinkedQueue<>();
  private final boolean manual;
  private double pendingTime;

  public LoopControl(boolean manual) {
    this.manual = manual;
  }

  public boolean manual() {
    return manual;
  }

  public <T> CompletableFuture<T> submit(Supplier<T> request) {
    var result = new CompletableFuture<T>();
    requests.add(
        () -> {
          try {
            result.complete(request.get());
          } catch (Throwable error) {
            result.completeExceptionally(error);
          }
        });
    return result;
  }

  public void drain() {
    Runnable request;
    while ((request = requests.poll()) != null) request.run();
  }

  public void advance(double seconds) {
    if (!manual || !Double.isFinite(seconds) || seconds < 0 || seconds > 30) {
      throw new IllegalArgumentException("Manual steps must be between zero and 30 seconds");
    }
    pendingTime += seconds;
  }

  public float elapsed(float realTime) {
    if (!manual) return Math.min(realTime, 0.25f);
    var step = Math.min(pendingTime, 1.0 / 60);
    pendingTime -= step;
    return (float) step;
  }

  public boolean settled() {
    return pendingTime < 0.000001;
  }
}
