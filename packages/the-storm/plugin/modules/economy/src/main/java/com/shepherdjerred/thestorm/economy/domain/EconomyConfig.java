package com.shepherdjerred.thestorm.economy.domain;

import com.shepherdjerred.thestorm.economy.app.Crystals;

/**
 * {@code plugins/TheStorm/economy.yml}, owned by the repository.
 *
 * @param currency the currency's names
 * @param startingBalance crystals granted, once, to a player joining for the first time
 * @param baltopSize how many players {@code /baltop} lists
 */
public record EconomyConfig(Currency currency, long startingBalance, int baltopSize) {

  /** The most rows {@code /baltop} may print, so it fits in a chat window. */
  public static final int MAX_BALTOP_SIZE = 20;

  public EconomyConfig {
    if (startingBalance < 0) {
      throw new IllegalArgumentException(
          "startingBalance must not be negative: " + startingBalance);
    }
    if (baltopSize < 1 || baltopSize > MAX_BALTOP_SIZE) {
      throw new IllegalArgumentException(
          "baltopSize must be between 1 and " + MAX_BALTOP_SIZE + ": " + baltopSize);
    }
  }

  /** {@link #startingBalance} as an amount. */
  public Crystals startingCrystals() {
    return new Crystals(startingBalance);
  }
}
