package com.shepherdjerred.thestorm.creative.app;

import com.shepherdjerred.thestorm.creative.domain.BodyRole;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Stored creative and survival bodies. One row per player per role. */
public interface BodyStore {

  /** Replaces {@code body}'s role for its player. */
  CompletableFuture<Void> save(VisitBody body);

  /** Both bodies stored for {@code player}, survival first when both exist. */
  CompletableFuture<List<VisitBody>> load(UUID player);

  /** Deletes every body stored for {@code player}. */
  CompletableFuture<Void> delete(UUID player);

  /** Deletes one role. The other role stays. */
  CompletableFuture<Void> delete(UUID player, BodyRole role);
}
