package com.shepherdjerred.thestorm.world.adapter.paper;

import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Managed, per-player rollout decision for the main-world crier. */
@FunctionalInterface
public interface CrierGate {

  CompletableFuture<Boolean> enabled(UUID player);
}
