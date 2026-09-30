package com.shepherdjerred.thestorm.spells.domain.temporary;

import java.time.Instant;

/**
 * A block a spell placed for a while (Wall, Entomb, Freeze, Carpet), recorded before the world is
 * changed so a crash can never leave it behind.
 *
 * @param key where it is
 * @param original the block data that was there, as a data string
 * @param placed the block data the spell put there
 * @param revertAt when the original comes back
 */
public record TemporaryBlock(BlockKey key, String original, String placed, Instant revertAt) {

  public TemporaryBlock {
    if (original.isBlank() || placed.isBlank()) {
      throw new IllegalArgumentException("temporary blocks need both block data strings");
    }
    if (original.equals(placed)) {
      throw new IllegalArgumentException("a temporary block must change the block: " + placed);
    }
  }
}
