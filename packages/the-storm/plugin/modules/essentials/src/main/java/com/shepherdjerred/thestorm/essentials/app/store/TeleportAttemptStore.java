package com.shepherdjerred.thestorm.essentials.app.store;

import com.shepherdjerred.thestorm.essentials.app.TeleportAttempt;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Durable charge obligations written before a paid teleport touches the ledger. */
public interface TeleportAttemptStore {

  CompletableFuture<Void> insert(TeleportAttempt attempt);

  CompletableFuture<List<TeleportAttempt>> pending();

  CompletableFuture<Void> delete(UUID id);
}
