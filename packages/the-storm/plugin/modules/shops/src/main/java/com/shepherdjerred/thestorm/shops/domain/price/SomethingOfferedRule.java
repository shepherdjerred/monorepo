package com.shepherdjerred.thestorm.shops.domain.price;

import java.util.Optional;

/** A shop must buy, sell or both. */
public final class SomethingOfferedRule implements PriceRule {

  @Override
  public Optional<PriceProblem> check(Optional<Price> buy, Optional<Price> sell) {
    return buy.isEmpty() && sell.isEmpty()
        ? Optional.of(new PriceProblem.NothingOffered())
        : Optional.empty();
  }
}
