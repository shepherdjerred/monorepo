package com.shepherdjerred.thestorm.rwf.app;

import static java.util.Objects.requireNonNull;

import java.util.OptionalInt;

/** Session preferences: an absent count is automatic sizing, and a count of zero disables bots. */
public record BotSettings(OptionalInt count, BotDifficulty difficulty) {
  public static final BotSettings DEFAULT =
      new BotSettings(OptionalInt.empty(), BotDifficulty.NORMAL);

  public BotSettings {
    requireNonNull(count);
    requireNonNull(difficulty);
    if (count.isPresent() && count.getAsInt() < 0) {
      throw new IllegalArgumentException("bot count must not be negative");
    }
  }

  public BotSettings withCount(OptionalInt next) {
    return new BotSettings(next, difficulty);
  }

  public BotSettings withDifficulty(BotDifficulty next) {
    return new BotSettings(count, next);
  }

  public String populationLabel() {
    return count.isEmpty() ? "Auto" : count.getAsInt() == 0 ? "Off" : count.getAsInt() + " bots";
  }

  /** Counts bots only, reserving space for every human already admitted. */
  public int botsFor(int automaticTarget, int humans, int maximum) {
    var wanted = count.isPresent() ? count.getAsInt() : Math.max(0, automaticTarget - humans);
    return Math.min(wanted, Math.max(0, maximum - humans));
  }
}
