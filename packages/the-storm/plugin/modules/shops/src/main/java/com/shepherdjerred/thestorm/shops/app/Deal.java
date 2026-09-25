package com.shepherdjerred.thestorm.shops.app;

import com.shepherdjerred.thestorm.economy.app.AccountId;
import com.shepherdjerred.thestorm.economy.app.Crystals;
import com.shepherdjerred.thestorm.shops.domain.trade.Direction;

/**
 * One trade, ready to settle.
 *
 * @param direction which way the goods go, from the customer's side
 * @param quantity how many items
 * @param price how many crystals
 * @param customer the customer's wallet and inventory
 * @param shop the shop's wallet (its owner, or the server) and stock
 * @param reason the ledger reason, such as {@code shop:chest:12:buy}
 */
public record Deal(
    Direction direction, int quantity, Crystals price, Party customer, Party shop, String reason) {

  /**
   * One side of a trade.
   *
   * @param account who pays or is paid
   * @param holdings where the items come from or go
   */
  public record Party(AccountId account, Holdings holdings) {}

  public Deal {
    if (quantity < 1) {
      throw new IllegalArgumentException("quantity must be positive: " + quantity);
    }
    if (price.amount() < 1) {
      throw new IllegalArgumentException("a trade costs at least one crystal");
    }
  }

  /** Who pays: the customer when buying, the shop when the customer sells. */
  public Party payer() {
    return switch (direction) {
      case BUY -> customer;
      case SELL -> shop;
    };
  }

  /** Who is paid. */
  public Party payee() {
    return switch (direction) {
      case BUY -> shop;
      case SELL -> customer;
    };
  }
}
