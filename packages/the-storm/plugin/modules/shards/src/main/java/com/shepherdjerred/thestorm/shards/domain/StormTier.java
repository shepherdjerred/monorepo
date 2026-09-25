package com.shepherdjerred.thestorm.shards.domain;

import java.util.Optional;

/**
 * An upgrade level, Storm I to Storm V. An item without a tier has never been upgraded; there is no
 * "tier zero".
 *
 * @param level 1 to {@link #MAX_LEVEL}
 */
public record StormTier(int level) {

  /** The highest tier, Storm V. Config tables carry exactly this many entries. */
  public static final int MAX_LEVEL = 5;

  private static final String[] NUMERALS = {"I", "II", "III", "IV", "V"};

  public StormTier {
    if (level < 1 || level > MAX_LEVEL) {
      throw new IllegalArgumentException(
          "storm tier must be 1.." + MAX_LEVEL + " but was " + level);
    }
  }

  /** Storm I, the first upgrade. */
  public static StormTier first() {
    return new StormTier(1);
  }

  /** The tier after {@code current}; an item without a tier upgrades to Storm I. */
  public static Optional<StormTier> after(Optional<StormTier> current) {
    return current.isPresent() ? current.get().next() : Optional.of(first());
  }

  /** The next tier, or empty at Storm V. */
  public Optional<StormTier> next() {
    return level < MAX_LEVEL ? Optional.of(new StormTier(level + 1)) : Optional.empty();
  }

  /** The Roman numeral shown to players ("III"). */
  public String numeral() {
    return NUMERALS[level - 1];
  }

  /** The zero-based index into per-tier config lists. */
  public int index() {
    return level - 1;
  }
}
