package com.shepherdjerred.thestorm.shops.domain.price;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.shops.domain.trade.Direction;
import java.util.List;
import java.util.Optional;

/**
 * What a shop charges and pays for one trade, always valid under {@link PriceRules#standard()}.
 *
 * @param buy what a customer pays to buy, if the shop sells
 * @param sell what a customer is paid to sell, if the shop buys
 */
public record ShopPrices(Optional<Price> buy, Optional<Price> sell) {

  public ShopPrices {
    var problems = PriceRules.standard().check(buy, sell);
    if (!problems.isEmpty()) {
      throw new IllegalArgumentException(problems.getFirst().describe());
    }
  }

  /** Validates a price pair, collecting every problem. */
  public static Result<ShopPrices, List<PriceProblem>> of(
      Optional<Price> buy, Optional<Price> sell) {
    var problems = PriceRules.standard().check(buy, sell);
    return problems.isEmpty()
        ? Result.ok(new ShopPrices(buy, sell))
        : Result.err(List.copyOf(problems));
  }

  public static ShopPrices buyOnly(long buy) {
    return new ShopPrices(Optional.of(Price.of(buy)), Optional.empty());
  }

  public static ShopPrices sellOnly(long sell) {
    return new ShopPrices(Optional.empty(), Optional.of(Price.of(sell)));
  }

  public static ShopPrices both(long buy, long sell) {
    return new ShopPrices(Optional.of(Price.of(buy)), Optional.of(Price.of(sell)));
  }

  /** The price for a customer trading in {@code direction}, if the shop offers it. */
  public Optional<Price> forDirection(Direction direction) {
    return switch (direction) {
      case BUY -> buy;
      case SELL -> sell;
    };
  }
}
