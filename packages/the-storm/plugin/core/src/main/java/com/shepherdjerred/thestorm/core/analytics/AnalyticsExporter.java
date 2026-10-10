package com.shepherdjerred.thestorm.core.analytics;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;

/** One bounded-size HTTP batch in flight. Failed batches remain durable for the next heartbeat. */
final class AnalyticsExporter implements AutoCloseable {
  private final AnalyticsStore store;
  private final AnalyticsTransport transport;
  private final AtomicBoolean running = new AtomicBoolean();
  private volatile boolean stopped;

  AnalyticsExporter(AnalyticsStore store, AnalyticsTransport transport) {
    this.store = store;
    this.transport = transport;
  }

  CompletableFuture<Void> flush() {
    if (stopped || !running.compareAndSet(false, true))
      return CompletableFuture.completedFuture(null);
    return drain().whenComplete((done, failure) -> running.set(false));
  }

  private CompletableFuture<Void> drain() {
    if (stopped) return CompletableFuture.completedFuture(null);
    return store
        .pending()
        .thenCompose(
            batch -> {
              if (batch.isEmpty() || stopped) return CompletableFuture.completedFuture(null);
              return transport
                  .send(batch)
                  .thenCompose(
                      done -> {
                        if (stopped) return CompletableFuture.completedFuture(null);
                        return store.acknowledge(batch).thenCompose(acknowledged -> drain());
                      });
            });
  }

  @Override
  public void close() {
    stopped = true;
    transport.close();
  }
}
