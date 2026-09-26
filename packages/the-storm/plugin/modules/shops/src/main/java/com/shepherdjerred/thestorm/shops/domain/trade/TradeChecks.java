package com.shepherdjerred.thestorm.shops.domain.trade;

import java.util.Optional;

/**
 * Whether both sides can hold up their end of a trade: the seller has the items and the buyer has
 * room for them. Money is checked by the ledger when it moves.
 */
public final class TradeChecks {

  private TradeChecks() {}

  /**
   * The first reason {@code quantity} items cannot change hands in {@code direction}, or empty.
   *
   * @param customer the customer's inventory
   * @param shop the shop's container
   */
  public static Optional<TradeProblem> goods(
      Direction direction, int quantity, Stockpile customer, Stockpile shop) {
    if (quantity < 1) {
      throw new IllegalArgumentException("quantity must be positive: " + quantity);
    }
    return switch (direction) {
      case BUY -> {
        if (shop.count() < quantity) {
          yield Optional.of(new TradeProblem.OutOfStock(shop.count(), quantity));
        }
        yield customer.space() < quantity
            ? Optional.of(new TradeProblem.NoRoom(customer.space(), quantity))
            : Optional.empty();
      }
      case SELL -> {
        if (customer.count() < quantity) {
          yield Optional.of(new TradeProblem.NotEnoughItems(customer.count(), quantity));
        }
        yield shop.space() < quantity
            ? Optional.of(new TradeProblem.ShopFull(shop.space(), quantity))
            : Optional.empty();
      }
    };
  }
}
