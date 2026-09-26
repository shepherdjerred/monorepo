package com.shepherdjerred.thestorm.arena.domain.reward;

import com.shepherdjerred.thestorm.arena.domain.wave.Tier;
import com.shepherdjerred.thestorm.arena.domain.wave.WaveKind;

/**
 * Crystal rewards, as in 2015: from {@code firstWave} on, every cleared boss wave pays each fighter
 * still standing, up to a cap per player per game. Both the payout and the cap scale with the arena
 * tier's reward multiplier, so harder tiers are worth more. Plus a vault-style bonus at milestone
 * waves.
 *
 * @param firstWave the first wave that can pay
 * @param perBossWave crystals per cleared boss wave, before the tier's reward multiplier
 * @param baseCapPerGame the most one player can earn in one game, before the tier's reward
 *     multiplier (the cap on Ominous I)
 * @param vault the milestone bonus
 */
public record RewardSettings(
    int firstWave, long perBossWave, long baseCapPerGame, VaultSettings vault) {

  public RewardSettings {
    if (firstWave < 1) {
      throw new IllegalArgumentException("firstWave must be at least 1: " + firstWave);
    }
    if (perBossWave < 0 || baseCapPerGame < 0) {
      throw new IllegalArgumentException("rewards must not be negative");
    }
    if (perBossWave > baseCapPerGame) {
      throw new IllegalArgumentException("perBossWave must not exceed baseCapPerGame");
    }
  }

  /** What clearing {@code wave} pays each fighter on {@code tier}, before the cap. */
  public long waveReward(int wave, WaveKind kind, Tier tier) {
    if (kind != WaveKind.BOSS || wave < firstWave) {
      return 0;
    }
    return Math.round(perBossWave * tier.reward());
  }

  /** The most one player can earn in one game on {@code tier}. */
  public long capPerGame(Tier tier) {
    return Math.round(baseCapPerGame * tier.reward());
  }
}
