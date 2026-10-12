package com.shepherdjerred.thestorm.economy.app;

import com.shepherdjerred.thestorm.economy.domain.MoneyFormat;

/**
 * The published {@link MoneyFormatter}: the domain's formatting with the currency names from {@code
 * economy.yml}, grouping thousands with commas whatever the server's locale.
 */
public final class ConfiguredMoneyFormatter implements MoneyFormatter {

  private final MoneyFormat format;

  public ConfiguredMoneyFormatter(MoneyFormat format) {
    this.format = format;
  }

  @Override
  public String words(Money amount) {
    return format.words(amount);
  }

  @Override
  public String symbol(Money amount) {
    return format.symbol(amount);
  }
}
