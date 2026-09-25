package com.shepherdjerred.thestorm.spells.app;

import com.shepherdjerred.thestorm.spells.domain.FocusKey;
import com.shepherdjerred.thestorm.spells.domain.Waypoint;
import com.shepherdjerred.thestorm.spells.domain.temporary.BlockKey;
import com.shepherdjerred.thestorm.spells.domain.temporary.TemporaryBlock;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/**
 * The spells module's storage. Every method runs off the main thread; callers complete the futures
 * back onto it through the scheduler.
 */
public interface SpellStore {

  /** Every temporary block still waiting to be reverted. */
  CompletableFuture<List<TemporaryBlock>> temporaryBlocks();

  /**
   * Records {@code blocks} before they are placed. Returns the keys actually stored: a position
   * that already has a pending revert (from a world that was not loaded at startup) is skipped and
   * must not be placed.
   */
  CompletableFuture<List<BlockKey>> saveTemporaryBlocks(List<TemporaryBlock> blocks);

  /** Forgets reverted blocks; returns how many records were removed. */
  CompletableFuture<Integer> deleteTemporaryBlocks(List<BlockKey> keys);

  /** Every player's Mark. */
  CompletableFuture<Map<UUID, Waypoint>> marks();

  /** Sets {@code player}'s Mark; returns 1. */
  CompletableFuture<Integer> saveMark(UUID player, Waypoint mark);

  /** Every focus binding's current generation. */
  CompletableFuture<Map<FocusKey, Long>> foci();

  /** Records a bind; returns 1. */
  CompletableFuture<Integer> saveFocus(FocusKey key, long generation);
}
