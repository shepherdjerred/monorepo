package com.shepherdjerred.thestorm.quests.app;

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
  CompletableFuture<Void> save(PlayerQuests state);

  /** The players with the most quest points, highest first. */
  CompletableFuture<List<Standing>> top(int limit);

  /** One row of {@link #top}. */
  record Standing(UUID player, long points) {}
}
