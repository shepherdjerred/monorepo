package com.shepherdjerred.thestorm.essentials.app.store;

import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportKind;
import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportUsage;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Each player's multiplier and cooldown per teleport kind. */
public interface TeleportUsageStore {

  /** {@code player}'s usage of {@code kind}, or empty if they never used it. */
  CompletableFuture<Optional<TeleportUsage>> find(UUID player, TeleportKind kind);

  /** Replaces {@code player}'s usage of {@code kind}. */
  CompletableFuture<Void> save(UUID player, TeleportKind kind, TeleportUsage usage);
}
