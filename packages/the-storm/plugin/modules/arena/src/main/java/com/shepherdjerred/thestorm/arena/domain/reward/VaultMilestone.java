package com.shepherdjerred.thestorm.arena.domain.reward;

/**
 * A wave that opens a vault when cleared.
 *
 * @param wave the milestone wave
 * @param loot what the vault holds
 */
public record VaultMilestone(int wave, LootTable loot) {

  public VaultMilestone {
    if (wave < 1) {
      throw new IllegalArgumentException("wave must be at least 1: " + wave);
    }
  }
}
