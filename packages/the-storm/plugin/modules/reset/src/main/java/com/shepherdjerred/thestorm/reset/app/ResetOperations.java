package com.shepherdjerred.thestorm.reset.app;

import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Server and external-account effects needed by a reset. */
public interface ResetOperations {

  void kick(UUID player);

  CompletableFuture<Void> eraseVanilla(UUID player);

  CompletableFuture<Void> clearPermissions(UUID player);
}
