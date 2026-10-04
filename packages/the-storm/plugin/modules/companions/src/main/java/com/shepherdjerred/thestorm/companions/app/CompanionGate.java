package com.shepherdjerred.thestorm.companions.app;

import java.util.concurrent.CompletableFuture;

/** Managed gameplay rollout gate, independent of chat provider availability. */
@FunctionalInterface
public interface CompanionGate extends AutoCloseable {
  CompletableFuture<Boolean> enabled();

  @Override
  default void close() {}
}
