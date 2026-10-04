package com.shepherdjerred.thestorm.rwf.app;

import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * The managed rollout decision for {@code /rwf join}: whether {@code player} may enter a match. A
 * failed or missing evaluation keeps the command unavailable.
 */
@FunctionalInterface
public interface JoinGate {

  CompletableFuture<Boolean> allows(UUID player);

  /** A gate that lets everyone in (tests, and the load test's bots). */
  static JoinGate open() {
    return player -> CompletableFuture.completedFuture(true);
  }
}
