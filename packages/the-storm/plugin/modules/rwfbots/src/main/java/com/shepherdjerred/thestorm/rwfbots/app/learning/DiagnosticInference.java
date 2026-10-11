package com.shepherdjerred.thestorm.rwfbots.app.learning;

import java.util.concurrent.CompletableFuture;

/**
 * Explicit disposable-fixture factory. Publishing this port never enables ordinary learned play.
 */
public interface DiagnosticInference {
  CompletableFuture<BatchedInference> load();
}
