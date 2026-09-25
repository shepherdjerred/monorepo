package com.shepherdjerred.thestorm.shops.domain.trade;

import java.time.Instant;
import java.util.UUID;

/**
 * A completed trade, as logged.
 *
 * @param site where it happened
 * @param customer who traded
 * @param customerName their name at the time
 * @param direction which way the goods went, from the customer's side
 * @param material the item's material key
 * @param quantity how many items moved
 * @param price how many crystals moved
 * @param at when
 */
public record TradeRecord(
    TradeSite site,
    UUID customer,
    String customerName,
    Direction direction,
    String material,
    int quantity,
    long price,
    Instant at) {

  public TradeRecord {
    if (quantity < 1 || price < 1) {
      throw new IllegalArgumentException("a trade moves at least one item and one crystal");
    }
  }
}
