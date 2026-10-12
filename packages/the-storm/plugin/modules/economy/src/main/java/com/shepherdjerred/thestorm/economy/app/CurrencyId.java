package com.shepherdjerred.thestorm.economy.app;

import java.util.Arrays;
import java.util.Locale;
import java.util.Optional;

/**
 * The currencies the ledger keeps apart. Every balance and transfer names one; a transfer never
 * converts between them.
 */
public enum CurrencyId {

  /** Crystals (CR), The Storm's survival currency. */
  CRYSTALS("crystals"),

  /** Red Warfare credits (RC), earned and spent only in Search and Destroy. */
  RWF_CREDITS("rwf_credits");

  private final String key;

  CurrencyId(String key) {
    this.key = key;
  }

  /** The stable key stored in the database and written in {@code economy.yml} and commands. */
  public String key() {
    return key;
  }

  /** The currency stored as {@code key}; an unknown key is a broken contract. */
  public static CurrencyId fromKey(String key) {
    return parse(key)
        .orElseThrow(() -> new IllegalArgumentException("unknown currency: '" + key + "'"));
  }

  /** The currency a player typed, ignoring case; empty when there is none by that name. */
  public static Optional<CurrencyId> parse(String key) {
    var wanted = key.toLowerCase(Locale.ROOT);
    return Arrays.stream(values()).filter(currency -> currency.key.equals(wanted)).findFirst();
  }
}
