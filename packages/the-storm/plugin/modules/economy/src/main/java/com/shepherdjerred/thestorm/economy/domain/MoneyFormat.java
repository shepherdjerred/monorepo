package com.shepherdjerred.thestorm.economy.domain;

import com.shepherdjerred.thestorm.economy.app.CurrencyId;
import com.shepherdjerred.thestorm.economy.app.Money;
import java.util.Collections;
import java.util.EnumMap;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;

/**
 * Writes amounts for chat: {@code 1 crystal}, {@code 1,250 crystals}, {@code 1,250 CR} or {@code 3
 * Credits}. Numbers always group thousands with commas, whatever the server's locale.
 *
 * @param currencies every currency's configured names
 */
public record MoneyFormat(Map<CurrencyId, Currency> currencies) {

  public MoneyFormat {
    var copy = new EnumMap<CurrencyId, Currency>(CurrencyId.class);
    copy.putAll(currencies);
    for (var currency : CurrencyId.values()) {
      if (!copy.containsKey(currency)) {
        throw new IllegalArgumentException("no names for currency " + currency.key());
      }
    }
    currencies = Collections.unmodifiableMap(copy);
  }

  /** The names of {@code currency}. */
  public Currency currency(CurrencyId currency) {
    return Objects.requireNonNull(currencies.get(currency), currency.key());
  }

  /** The amount with the singular or plural name, for sentences: {@code 1,250 crystals}. */
  public String words(Money money) {
    var names = currency(money.currency());
    var name = money.amount() == 1 ? names.singular() : names.plural();
    return number(money) + " " + name;
  }

  /** The amount with the symbol, for tables: {@code 1,250 CR}. */
  public String symbol(Money money) {
    return number(money) + " " + currency(money.currency()).symbol();
  }

  /** The bare amount with thousands separators: {@code 1,250}. */
  public static String number(Money money) {
    return String.format(Locale.ROOT, "%,d", money.amount());
  }
}
