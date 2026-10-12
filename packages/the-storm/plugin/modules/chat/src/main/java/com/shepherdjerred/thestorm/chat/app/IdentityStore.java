package com.shepherdjerred.thestorm.chat.app;

import com.shepherdjerred.thestorm.chat.domain.Identity;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Durable identity operations. Nickname uniqueness is enforced in the write transaction. */
public interface IdentityStore {
  record Audit(UUID actor, java.time.Instant at, String action) {}

  CompletableFuture<Map<UUID, Identity>> load();

  CompletableFuture<Void> save(UUID player, Identity identity, Audit audit);
}
