package com.shepherdjerred.thestorm.shops.domain.price;

import java.util.Optional;

/**
 * A shop that both buys and sells an item must not pay more than it charges; otherwise a player
 * could buy and sell back in a loop and print crystals.
 */
public final class SellNotAboveBuyRule implements PriceRule {

  @Override
  public Optional<PriceProblem> check(Optional<Price> buy, Optional<Price> sell) {
    if (buy.isEmpty() || sell.isEmpty()) {
      return Optional.empty();
    }
    var charged = buy.orElseThrow();
    var paid = sell.orElseThrow();
    return paid.compareTo(charged) > 0
        ? Optional.of(new PriceProblem.SellAboveBuy(charged.crystals(), paid.crystals()))
        : Optional.empty();
  }
}
