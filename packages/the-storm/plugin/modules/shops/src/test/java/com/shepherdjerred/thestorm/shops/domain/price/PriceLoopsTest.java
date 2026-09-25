package com.shepherdjerred.thestorm.shops.domain.price;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.Test;

final class PriceLoopsTest {

  private static PriceLoops.Offer offer(String item, int quantity, ShopPrices prices) {
    return new PriceLoops.Offer(item, quantity, prices, item + "-shop");
  }

  // Reynold's: 16 coal for 48 (3 each), buys 16 for 16 (1 each).
  private static final PriceLoops.Offer REYNOLDS = offer("coal", 16, ShopPrices.both(48, 16));

  @Test
  void payingMoreThanAnotherChargesIsALoop() {
    assertThat(PriceLoops.conflict(offer("coal", 1, ShopPrices.sellOnly(4)), List.of(REYNOLDS)))
        .contains(REYNOLDS);
  }

  @Test
  void chargingLessThanAnotherPaysIsALoop() {
    assertThat(PriceLoops.conflict(offer("coal", 32, ShopPrices.buyOnly(31)), List.of(REYNOLDS)))
        .contains(REYNOLDS);
  }

  @Test
  void equalPerItemPricesAcrossTradeSizesAreFine() {
    assertThat(PriceLoops.conflict(offer("coal", 1, ShopPrices.sellOnly(3)), List.of(REYNOLDS)))
        .isEmpty();
    assertThat(PriceLoops.conflict(offer("coal", 16, ShopPrices.buyOnly(16)), List.of(REYNOLDS)))
        .isEmpty();
  }

  @Test
  void otherItemsNeverConflict() {
    assertThat(PriceLoops.conflict(offer("emerald", 1, ShopPrices.sellOnly(99)), List.of(REYNOLDS)))
        .isEmpty();
  }

  @Test
  void offersTradeAtLeastOneItem() {
    assertThatThrownBy(() -> offer("coal", 0, ShopPrices.buyOnly(1)))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
