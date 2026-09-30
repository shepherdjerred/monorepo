package com.shepherdjerred.thestorm.world.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import org.junit.jupiter.api.Test;

final class MerchantStockTest {

  @Test
  void rotatesTwoFiniteOffersWithBoundedDeterministicCosts() {
    var day = LocalDate.of(2026, 9, 27);
    var first = MerchantStock.forDate(day);

    assertThat(MerchantStock.forDate(day)).isEqualTo(first);
    assertThat(first).hasSize(2).extracting(MerchantStock.Offer::item).doesNotHaveDuplicates();
    assertThat(MerchantStock.forDate(day.plusDays(1)))
        .extracting(MerchantStock.Offer::item)
        .isNotEqualTo(first.stream().map(MerchantStock.Offer::item).toList());
    for (var offer : first) {
      assertThat(offer.resultCount()).isBetween(1, 8);
      assertThat(offer.costCount()).isBetween(4, 18);
      assertThat(offer.maxUses()).isBetween(4, 8);
    }
  }
}
