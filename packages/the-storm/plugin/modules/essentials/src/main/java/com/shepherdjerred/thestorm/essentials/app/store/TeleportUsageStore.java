package com.shepherdjerred.thestorm.essentials.app.store;

import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportKind;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportUsage;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Player-wide usage, with atomic, idempotent delivery confirmation. */
public interface TeleportUsageStore {
  CompletableFuture<Optional<TeleportUsage>> find(UUID player, Instant since);

  /** Record delivery, set the cooldown and clear its charge obligation in one transaction. */
  CompletableFuture<Void> confirm(
      UUID player, UUID operation, TeleportKind kind, TeleportUsage usage);
}
