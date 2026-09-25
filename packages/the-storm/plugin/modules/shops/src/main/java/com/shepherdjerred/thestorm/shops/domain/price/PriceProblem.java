package com.shepherdjerred.thestorm.shops.domain.price;

/** Why a pair of buy and sell prices was refused. */
public sealed interface PriceProblem {

  /** Neither side has a price, so nothing could be traded. */
  record NothingOffered() implements PriceProblem {}

  /**
   * The shop would pay more for an item than it charges, so anyone could buy and sell back forever.
   *
   * @param buy what the customer pays
   * @param sell what the customer is paid
   */
  record SellAboveBuy(long buy, long sell) implements PriceProblem {}

  /** A sentence for players and config errors. */
  default String describe() {
    return switch (this) {
      case NothingOffered() -> "a shop needs a buy price, a sell price or both";
      case SellAboveBuy(var buy, var sell) ->
          "the sell price (" + sell + ") must not be above the buy price (" + buy + ")";
    };
  }
}
