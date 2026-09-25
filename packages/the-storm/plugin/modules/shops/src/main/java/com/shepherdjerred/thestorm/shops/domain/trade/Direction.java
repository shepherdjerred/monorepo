package com.shepherdjerred.thestorm.shops.domain.trade;

import java.util.Locale;

/** Which way a trade goes, from the customer's side. */
public enum Direction {
  /** The customer pays crystals and receives items. */
  BUY,
  /** The customer hands over items and is paid crystals. */
  SELL;

  /** A stable lowercase id, used in storage. */
  public String id() {
    return name().toLowerCase(Locale.ROOT);
  }

  public static Direction fromId(String id) {
    return valueOf(id.toUpperCase(Locale.ROOT));
  }
}
