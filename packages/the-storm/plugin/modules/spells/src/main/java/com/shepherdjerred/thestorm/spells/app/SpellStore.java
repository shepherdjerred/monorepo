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
   * Every temporary block not yet known to be reverted on disk: pending ones and reverted ones
   * whose world has not been saved since. Reverting any of them again is harmless.
   */
  CompletableFuture<List<TemporaryBlock>> temporaryBlocks();

  /**
   * Records {@code blocks} before they are placed. Returns the keys actually stored: a position
   * with a pending (not reverted) record, for example from a world that was not loaded at startup,
   * is skipped and must not be placed. A reverted record at the position is replaced.
   */
  CompletableFuture<List<BlockKey>> saveTemporaryBlocks(List<TemporaryBlock> blocks);

  /** Forgets records of blocks that never reached the world; returns how many were removed. */
  CompletableFuture<Integer> deleteTemporaryBlocks(List<BlockKey> keys);

  /** Marks blocks reverted in the world; returns how many records were marked. */
  CompletableFuture<Integer> markReverted(List<BlockKey> keys);

  /**
   * Forgets the reverted records among {@code keys} (their chunk was saved); pending records are
   * kept. Returns how many were removed.
   */
  CompletableFuture<Integer> forgetReverted(List<BlockKey> keys);

  /** Forgets every reverted record in {@code world} (it was saved); returns how many. */
  CompletableFuture<Integer> forgetReverted(String world);

  /** Every player's Mark. */
  CompletableFuture<Map<UUID, Waypoint>> marks();

  /** Sets {@code player}'s Mark; returns 1. */
  CompletableFuture<Integer> saveMark(UUID player, Waypoint mark);

  /** Every focus binding's current generation. */
  CompletableFuture<Map<FocusKey, Long>> foci();

  /** Records a bind; returns 1. */
  CompletableFuture<Integer> saveFocus(FocusKey key, long generation);
}
