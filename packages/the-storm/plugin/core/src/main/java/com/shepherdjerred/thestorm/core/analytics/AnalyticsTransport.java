package com.shepherdjerred.thestorm.core.analytics;

import java.util.List;
import java.util.concurrent.CompletableFuture;

interface AnalyticsTransport extends AutoCloseable {
  CompletableFuture<Void> send(List<AnalyticsStore.Pending> batch);

  @Override
  void close();
}
