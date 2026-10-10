package com.shepherdjerred.thestorm.core.analytics;

import java.util.concurrent.CompletableFuture;

/** One bounded-size HTTP batch in flight. Failed batches remain durable until a later flush. */
final class AnalyticsExporter implements AutoCloseable {
  private final AnalyticsStore store;
  private final AnalyticsTransport transport;
  private final Object lock = new Object();
  private CompletableFuture<Void> inFlight = CompletableFuture.completedFuture(null);
  private volatile boolean stopped;

  AnalyticsExporter(AnalyticsStore store, AnalyticsTransport transport) {
    this.store = store;
    this.transport = transport;
  }

  CompletableFuture<Void> flush() {
    synchronized (lock) {
      if (stopped) return CompletableFuture.completedFuture(null);
      inFlight = inFlight.handle((done, failure) -> (Void) null).thenCompose(done -> drain());
      return inFlight;
    }
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
