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

  /**
   * Temporary-block records whose chunk marker and world state have not both been reverted in
   * memory and whose recovery row has not been deleted. Reverting any of them again is harmless.
   */
  CompletableFuture<List<TemporaryBlock>> temporaryBlocks();

  /**
   * Records {@code blocks} before they are placed. Returns the keys actually stored: a position
   * with any existing record is skipped until the prior block and chunk marker are reverted and its
   * row is deleted.
   */
  CompletableFuture<List<BlockKey>> saveTemporaryBlocks(List<TemporaryBlock> blocks);

  /** Forgets records never placed or safely covered by the chunk marker recovery contract. */
  CompletableFuture<Integer> deleteTemporaryBlocks(List<BlockKey> keys);

  /** Marks blocks reverted in the world; returns how many records were marked. */
  CompletableFuture<Integer> markReverted(List<BlockKey> keys);

  /**
   * Forgets reverted records among {@code keys}; callers must first establish that their chunk's
   * disk image no longer contains the temporary block. Pending records are kept.
   */
  CompletableFuture<Integer> forgetReverted(List<BlockKey> keys);

  /** Forgets every reverted record in {@code world} after external durability proof. */
  CompletableFuture<Integer> forgetReverted(String world);

  /** Every player's Mark. */
  CompletableFuture<Map<UUID, Waypoint>> marks();

  /** Sets {@code player}'s Mark; returns 1. */
  CompletableFuture<Integer> saveMark(UUID player, Waypoint mark);

  /** Every focus binding's current generation. */
  CompletableFuture<Map<FocusKey, Long>> foci();

  /** Records a bind; returns 1. */
  CompletableFuture<Integer> saveFocus(FocusKey key, long generation);

  /** Restores the prior generation only if a failed handoff still owns {@code generation}. */
  CompletableFuture<Integer> rollbackFocus(FocusKey key, long generation);
}
