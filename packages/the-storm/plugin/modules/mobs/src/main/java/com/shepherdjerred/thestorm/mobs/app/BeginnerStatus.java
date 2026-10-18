package com.shepherdjerred.thestorm.mobs.app;

import java.time.Duration;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Read-only personal protection, usable by onboarding without Paper or storage access. */
public interface BeginnerStatus {
  CompletableFuture<Status> status(UUID player);

  /** Main-thread cached status; empty while initial storage or flag evaluation is loading. */
  Optional<Status> current(UUID player);

  record Status(
      boolean enabled,
      Duration active,
      Duration calmFor,
      Duration normalAfter,
      double damageMultiplier) {
    public boolean protectsFromNpcs() {
      return enabled && active.compareTo(normalAfter) < 0;
    }
  }
}
