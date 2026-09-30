package com.shepherdjerred.thestorm.world.app;

import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Managed, per-player rollout decision for main-world trader visits. */
@FunctionalInterface
public interface MerchantGate {

  CompletableFuture<Boolean> enabled(UUID player);
}
