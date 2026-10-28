package com.shepherdjerred.thestorm.shops.domain.price;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.shops.domain.trade.Direction;
import com.shepherdjerred.thestorm.shops.domain.trade.PartialQuantity;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Shop tax, price bands, and a lot that cannot be filled in full. */
final class ShopLevyTest {

  @Test
  void taxIsAPercentOfThePriceRoundedDown() {
    assertThat(ShopLevy.of(100, 10)).isEqualTo(new ShopLevy(100, 10));
    assertThat(ShopLevy.of(100, 10).net()).isEqualTo(90);
    assertThat(ShopLevy.of(1, 50).tax()).isZero();
    assertThat(ShopLevy.of(200, 100).net()).isZero();
    assertThatThrownBy(() -> ShopLevy.of(10, 101)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void aMaterialBandReplacesTheGlobalOne() {
    var limits =
        new PriceLimits(
            1, 1_000, 1, 1_000, Map.of("diamond", new PriceLimits.Band(100, 500, 50, 400)));

    assertThat(limits.check(Direction.BUY, 50, "coal")).isEmpty();
    assertThat(limits.check(Direction.BUY, 50, "diamond"))
        .hasValueSatisfying(violation -> assertThat(violation.min()).isEqualTo(100));
    assertThat(limits.check(Direction.SELL, 400, "DIAMOND")).isEmpty();
  }

  @Test
  void aPartialLotScalesThePriceAndStaysAtLeastOneCrystal() {
    assertThat(PartialQuantity.fit(64, 10, 6)).isEqualTo(6);
    assertThat(PartialQuantity.fit(16, 0, 64)).isZero();
    assertThat(PartialQuantity.scale(64, 16, 1)).isEqualTo(4);
    assertThat(PartialQuantity.scale(10, 64, 1)).isEqualTo(1);
  }
}
