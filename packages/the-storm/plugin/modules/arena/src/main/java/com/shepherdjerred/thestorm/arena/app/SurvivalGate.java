package com.shepherdjerred.thestorm.arena.app;

import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Session-scoped survival rollout; evaluated before belongings are captured. */
public interface SurvivalGate {
  CompletableFuture<Boolean> enabled(UUID player);
}
