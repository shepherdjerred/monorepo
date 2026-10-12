package com.shepherdjerred.thestorm.arena.domain.survival;

/** Deterministic equipment tiers for privileged shared practice lobbies. */
public record DebugPreset(
    int round, int weaponTier, boolean iron, boolean powered, boolean assembled, int emeralds) {
  public static DebugPreset at(int round) {
    if (round < 1 || round > 1000) throw new IllegalArgumentException("Round must be 1–1000");
    return new DebugPreset(
        round,
        round < 8 ? 0 : round < 15 ? 1 : round < 25 ? 2 : 3,
        round >= 4,
        round >= 8,
        round >= 15,
        round < 4 ? 0 : round < 8 ? 24 : 128);
  }
}
