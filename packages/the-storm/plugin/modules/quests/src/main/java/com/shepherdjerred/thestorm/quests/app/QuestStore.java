package com.shepherdjerred.thestorm.quests.app;

import com.shepherdjerred.thestorm.quests.domain.model.Action;
import com.shepherdjerred.thestorm.quests.domain.state.PlayerQuests;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * Where quest state is kept. Futures complete off the main thread. Saves are applied in the order
 * they are requested, each replacing the player's stored state with the snapshot given.
 */
public interface QuestStore {

  /** The player's stored state, or an empty one if they never did a quest. */
  CompletableFuture<PlayerQuests> load(UUID player);

  /** Replaces the player's stored state with {@code state}. */
  CompletableFuture<Void> save(PlayerQuests state, List<PendingWorld> effects);

  default CompletableFuture<Void> save(PlayerQuests state) {
    return save(state, List.of());
  }

  /** World actions committed with quest state and awaiting delivery to the player. */
  CompletableFuture<List<PendingWorld>> pending(UUID player);

  /** Atomically moves a pending action to an in-doubt state before touching Paper. */
  CompletableFuture<Boolean> claim(UUID effect);

  /** Reopens an in-doubt action after an operator confirms it did not take effect. */
  CompletableFuture<Boolean> retry(UUID player, UUID effect);

  /** Removes an in-doubt action after an operator confirms it already took effect. */
  CompletableFuture<Boolean> complete(UUID player, UUID effect);

  /** Removes one action after it has been delivered. */
  CompletableFuture<Void> acknowledge(UUID effect);

  record PendingWorld(UUID id, UUID player, String quest, Action action, Status status) {
    public PendingWorld(UUID id, UUID player, String quest, Action action) {
      this(id, player, quest, action, Status.PENDING);
    }
  }

  enum Status {
    PENDING,
    IN_DOUBT
  }

  /** The players with the most quest points, highest first. */
  CompletableFuture<List<Standing>> top(int limit);

  /** One row of {@link #top}. */
  record Standing(UUID player, long points) {}
}
