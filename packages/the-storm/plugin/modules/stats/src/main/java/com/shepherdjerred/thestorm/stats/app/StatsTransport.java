package com.shepherdjerred.thestorm.stats.app;

import java.util.concurrent.CompletableFuture;

/** Asynchronous HTTP batch delivery port to {@code storm-stats}. */
public interface StatsTransport extends AutoCloseable {

  CompletableFuture<Void> send(StatsWire.IngestBatch batch);

  @Override
  void close();
}
