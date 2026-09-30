package com.shepherdjerred.thestorm.skills.domain;

/** Strict repository-owned settings for skill progression. */
public record SkillsConfig(int leaderboardSize, int acrobaticsCooldownSeconds) {
  public SkillsConfig {
    if (leaderboardSize < 1 || leaderboardSize > 50) {
      throw new IllegalArgumentException("leaderboardSize must be between 1 and 50");
    }
    if (acrobaticsCooldownSeconds < 1 || acrobaticsCooldownSeconds > 3600) {
      throw new IllegalArgumentException("acrobaticsCooldownSeconds must be between 1 and 3600");
    }
  }
}
