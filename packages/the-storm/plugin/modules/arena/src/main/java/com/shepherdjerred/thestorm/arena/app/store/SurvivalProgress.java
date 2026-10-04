package com.shepherdjerred.thestorm.arena.app.store;

import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Idempotent permanent XP; run currency never enters the economy module. */
public interface SurvivalProgress {
  record Credit(UUID player, UUID run, String event, long xp) {
    public Credit {
      if (xp < 1 || event.isBlank()) {
        throw new IllegalArgumentException("Invalid XP credit");
      }
    }
  }

  CompletableFuture<Long> xp(UUID player);

  CompletableFuture<Long> credit(Credit credit);
}
