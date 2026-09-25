package com.shepherdjerred.thestorm.shops.domain.price;

import java.util.Optional;

/** One rule a buy/sell price pair must follow. */
@FunctionalInterface
public interface PriceRule {

  /** The problem with these prices, or empty if the rule holds. */
  Optional<PriceProblem> check(Optional<Price> buy, Optional<Price> sell);
}
