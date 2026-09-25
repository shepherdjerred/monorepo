package com.shepherdjerred.thestorm.economy.domain;

import com.shepherdjerred.thestorm.economy.app.Crystals;
import java.util.Locale;

/**
 * Writes amounts for chat: {@code 1 crystal}, {@code 1,250 crystals} or {@code 1,250 CR}. Numbers
 * always group thousands with commas, whatever the server's locale.
 *
 * @param currency the configured currency names
 */
public record CrystalFormat(Currency currency) {

  /** The amount with the singular or plural name, for sentences: {@code 1,250 crystals}. */
  public String words(Crystals crystals) {
    var name = crystals.amount() == 1 ? currency.singular() : currency.plural();
    return number(crystals) + " " + name;
  }

  /** The amount with the symbol, for tables: {@code 1,250 CR}. */
  public String symbol(Crystals crystals) {
    return number(crystals) + " " + currency.symbol();
  }

  /** The bare amount with thousands separators: {@code 1,250}. */
  public static String number(Crystals crystals) {
    return String.format(Locale.ROOT, "%,d", crystals.amount());
  }
}
