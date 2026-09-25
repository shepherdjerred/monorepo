package com.shepherdjerred.thestorm.arena.domain.reward;

import com.shepherdjerred.thestorm.arena.domain.kit.ItemSpec;

/**
 * One possible roll of a loot table.
 *
 * @param weight how likely, relative to the table's other entries
 * @param item what it gives
 */
public record LootEntry(int weight, ItemSpec item) {

  public LootEntry {
    if (weight < 1 || weight > 1000) {
      throw new IllegalArgumentException("weight must be 1-1000: " + weight);
    }
    if (item.slot().isPresent()) {
      throw new IllegalArgumentException("loot has no slot; use null");
    }
  }
}
