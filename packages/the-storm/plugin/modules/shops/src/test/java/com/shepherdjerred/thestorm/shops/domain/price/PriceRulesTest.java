package com.shepherdjerred.thestorm.shops.domain.price;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.shops.domain.trade.Direction;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class PriceRulesTest {

  private static Optional<Price> price(long crystals) {
    return Optional.of(Price.of(crystals));
  }

  @Test
  void aPriceIsAtLeastOneCrystal() {
    assertThatThrownBy(() -> Price.of(0)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Price.of(-5)).isInstanceOf(IllegalArgumentException.class);
    assertThat(Price.of(1).crystals()).isEqualTo(1);
  }

  @Test
  void aPriceIsAtMostTheMaximum() {
    assertThat(Price.of(Price.MAX).crystals()).isEqualTo(Price.MAX);
    assertThatThrownBy(() -> Price.of(Price.MAX + 1)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void lotsMultiplyThePrice() {
    assertThat(Price.of(64).times(16)).isEqualTo(1024);
    assertThatThrownBy(() -> Price.of(1).times(0)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void pricesCompareByCrystals() {
    assertThat(Price.of(5)).isLessThan(Price.of(6));
  }

  @Test
  void somethingMustBeOffered() {
    var rule = new SomethingOfferedRule();

    assertThat(rule.check(Optional.empty(), Optional.empty()))
        .contains(new PriceProblem.NothingOffered());
    assertThat(rule.check(price(5), Optional.empty())).isEmpty();
    assertThat(rule.check(Optional.empty(), price(5))).isEmpty();
  }

  @Test
  void sellMayNotExceedBuy() {
    var rule = new SellNotAboveBuyRule();

    assertThat(rule.check(price(40), price(50))).contains(new PriceProblem.SellAboveBuy(40, 50));
    assertThat(rule.check(price(50), price(50))).isEmpty();
    assertThat(rule.check(price(50), price(40))).isEmpty();
    assertThat(rule.check(price(50), Optional.empty())).isEmpty();
    assertThat(rule.check(Optional.empty(), price(50))).isEmpty();
  }

  @Test
  void theStandardRulesCollectEveryProblem() {
    var rules = PriceRules.standard();

    assertThat(rules.check(Optional.empty(), Optional.empty()))
        .containsExactly(new PriceProblem.NothingOffered());
    assertThat(rules.check(price(1), price(2)))
        .containsExactly(new PriceProblem.SellAboveBuy(1, 2));
    assertThat(rules.check(price(2), price(1))).isEmpty();
  }

  @Test
  void customRulesCompose() {
    PriceRule neverFree = (buy, sell) -> Optional.of(new PriceProblem.NothingOffered());
    var rules = new PriceRules(List.of(neverFree, neverFree));

    assertThat(rules.check(price(1), price(1))).hasSize(2);
  }

  @Test
  void shopPricesAreAlwaysValid() {
    assertThatThrownBy(() -> new ShopPrices(Optional.empty(), Optional.empty()))
        .hasMessageContaining("buy price, a sell price or both");
    assertThatThrownBy(() -> ShopPrices.both(40, 50)).hasMessageContaining("must not be above");
    assertThat(ShopPrices.both(50, 40).sell()).isEqualTo(price(40));
  }

  @Test
  void shopPricesOfReportsProblemsInsteadOfThrowing() {
    assertThat(ShopPrices.of(price(1), price(9)))
        .isEqualTo(Result.err(List.of(new PriceProblem.SellAboveBuy(1, 9))));
    assertThat(ShopPrices.of(price(9), price(1))).isEqualTo(Result.ok(ShopPrices.both(9, 1)));
  }

  @Test
  void eachDirectionHasItsPrice() {
    var prices = ShopPrices.both(50, 40);

    assertThat(prices.forDirection(Direction.BUY)).isEqualTo(price(50));
    assertThat(prices.forDirection(Direction.SELL)).isEqualTo(price(40));
    assertThat(ShopPrices.buyOnly(5).forDirection(Direction.SELL)).isEmpty();
    assertThat(ShopPrices.sellOnly(5).forDirection(Direction.BUY)).isEmpty();
  }

  @Test
  void problemsDescribeThemselves() {
    assertThat(new PriceProblem.NothingOffered().describe()).contains("buy price");
    assertThat(new PriceProblem.SellAboveBuy(3, 4).describe())
        .isEqualTo("the sell price (4) must not be above the buy price (3)");
  }
}
