package com.shepherdjerred.thestorm.core.protection;

import java.util.List;

/**
 * Claim and admin-region chunks. Main thread only: the towns module reads them from memory. Random
 * teleport uses this to land far from settled land; {@link Protection} stays a yes-or-no check.
 */
public interface SettledLand {

  /**
   * Every settled chunk in {@code world}. A chunk may appear twice when a region covers a claim.
   */
  List<Chunk> chunks(String world);

  /**
   * A chunk column.
   *
   * @param x chunk x
   * @param z chunk z
   */
  record Chunk(int x, int z) {}
}
