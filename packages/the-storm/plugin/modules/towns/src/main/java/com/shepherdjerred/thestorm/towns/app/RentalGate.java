package com.shepherdjerred.thestorm.towns.app;

import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Gates new admissions only; renewal, protection and recovery do not depend on rollout. */
public interface RentalGate {
  CompletableFuture<Boolean> enabled(UUID player);
}
