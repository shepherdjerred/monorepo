package com.shepherdjerred.thestorm.rwf.app.shop;

import java.time.Instant;
import java.util.UUID;

/**
 * One kit purchase.
 *
 * @param id the purchase, and the idempotency key of its credit transfer
 * @param player who buys
 * @param kit the kit id
 * @param price the credits it costs
 * @param at when it was opened
 */
public record Purchase(UUID id, UUID player, String kit, long price, Instant at) {

  public Purchase {
    if (price <= 0) {
      throw new IllegalArgumentException("a purchase costs something: " + price);
    }
  }

  /** The ledger reason Red Warfare's shop writes, {@code rwf:kit:<id>}. */
  public String reason() {
    return "rwf:kit:" + kit;
  }
}
