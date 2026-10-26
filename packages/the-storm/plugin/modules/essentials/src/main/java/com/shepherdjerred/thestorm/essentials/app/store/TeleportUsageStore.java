package com.shepherdjerred.thestorm.essentials.app.store;

import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportKind;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportUsage;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Per-command cooldowns, with atomic, idempotent delivery confirmation. */
public interface TeleportUsageStore {
  /** A successful arrival. Repeating {@code operation} does not move the cooldown. */
  record Confirmation(UUID player, UUID operation, TeleportKind kind, Instant cooldownUntil) {}

  CompletableFuture<Optional<TeleportUsage>> find(UUID player);

  /** Record the cooldown and clear its charge obligation in one transaction. */
  CompletableFuture<Void> confirm(Confirmation confirmation);
}
