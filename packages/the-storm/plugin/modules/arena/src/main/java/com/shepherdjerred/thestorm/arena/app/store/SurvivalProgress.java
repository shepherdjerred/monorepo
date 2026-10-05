package com.shepherdjerred.thestorm.arena.app.store;

import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Idempotent permanent XP; run currency never enters the economy module. */
public interface SurvivalProgress {
  record Tips(
      java.util.Set<com.shepherdjerred.thestorm.arena.domain.survival.TutorialKey> seen,
      boolean enabled) {
    public Tips {
      seen = java.util.Set.copyOf(seen);
    }
  }

  CompletableFuture<Tips> tips(UUID player);

  CompletableFuture<Void> tip(
      UUID player, com.shepherdjerred.thestorm.arena.domain.survival.TutorialKey key);

  CompletableFuture<Void> tipsEnabled(UUID player, boolean enabled);

  CompletableFuture<Void> resetTips(UUID player);

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
