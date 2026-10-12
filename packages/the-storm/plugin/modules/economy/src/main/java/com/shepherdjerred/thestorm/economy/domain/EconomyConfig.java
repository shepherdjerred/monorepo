package com.shepherdjerred.thestorm.economy.domain;

import com.shepherdjerred.thestorm.economy.app.CurrencyId;
import com.shepherdjerred.thestorm.economy.app.Money;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.Map;
import java.util.TreeSet;
import java.util.stream.Collectors;

/**
 * {@code plugins/TheStorm/economy.yml}, owned by the repository.
 *
 * @param currencies every currency's names, keyed by {@link CurrencyId#key()}; exactly one entry
 *     per currency
 * @param startingBalance crystals granted, once, to a player joining for the first time
 * @param baltopSize how many players {@code /baltop} lists
 */
public record EconomyConfig(
    Map<String, Currency> currencies, long startingBalance, int baltopSize) {

  /** The most rows {@code /baltop} may print, so it fits in a chat window. */
  public static final int MAX_BALTOP_SIZE = 20;

  public EconomyConfig {
    currencies = Map.copyOf(currencies);
    var expected =
        Arrays.stream(CurrencyId.values())
            .map(CurrencyId::key)
            .collect(Collectors.toCollection(TreeSet::new));
    if (!currencies.keySet().equals(expected)) {
      throw new IllegalArgumentException(
          "currencies must name exactly " + expected + ": " + new TreeSet<>(currencies.keySet()));
    }
    if (startingBalance < 0) {
      throw new IllegalArgumentException(
          "startingBalance must not be negative: " + startingBalance);
    }
    if (baltopSize < 1 || baltopSize > MAX_BALTOP_SIZE) {
      throw new IllegalArgumentException(
          "baltopSize must be between 1 and " + MAX_BALTOP_SIZE + ": " + baltopSize);
    }
  }

  /** {@link #startingBalance} as an amount of crystals. */
  public Money startingCrystals() {
    return Money.crystals(startingBalance);
  }

  /** The configured names as a formatter. */
  public MoneyFormat format() {
    var byId = new EnumMap<CurrencyId, Currency>(CurrencyId.class);
    currencies.forEach((key, names) -> byId.put(CurrencyId.fromKey(key), names));
    return new MoneyFormat(byId);
  }
}
