package com.shepherdjerred.thestorm.arena.domain.reward;

import com.shepherdjerred.thestorm.arena.domain.wave.Tier;
import com.shepherdjerred.thestorm.arena.domain.wave.WaveKind;

/**
 * Crystal rewards, as in 2015: from {@code firstWave} on, every cleared boss wave pays each fighter
 * still standing, up to {@code capPerGame} per player per game. Plus a vault-style bonus at
 * milestone waves.
 *
 * @param firstWave the first wave that can pay
 * @param perBossWave crystals per cleared boss wave, before the tier's reward multiplier
 * @param capPerGame the most one player can earn in one game
 * @param vault the milestone bonus
 */
public record RewardSettings(
    int firstWave, long perBossWave, long capPerGame, VaultSettings vault) {

  public RewardSettings {
    if (firstWave < 1) {
      throw new IllegalArgumentException("firstWave must be at least 1: " + firstWave);
    }
    if (perBossWave < 0 || capPerGame < 0) {
      throw new IllegalArgumentException("rewards must not be negative");
    }
    if (perBossWave > capPerGame) {
      throw new IllegalArgumentException("perBossWave must not exceed capPerGame");
    }
  }

  /** What clearing {@code wave} pays each fighter, before the cap. */
  public long waveReward(int wave, WaveKind kind, Tier tier) {
    if (kind != WaveKind.BOSS || wave < firstWave) {
      return 0;
    }
    return Math.round(perBossWave * tier.reward());
  }
}
