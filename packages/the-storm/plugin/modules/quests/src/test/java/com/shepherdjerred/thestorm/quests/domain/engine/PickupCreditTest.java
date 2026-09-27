package com.shepherdjerred.thestorm.quests.domain.engine;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

final class PickupCreditTest {

  @Test
  void onlyNewlyAcquiredItemsCount() {
    assertThat(PickupCredit.amount(12, 0, false)).isEqualTo(12);
    assertThat(PickupCredit.amount(12, 5, false)).isEqualTo(7);
    assertThat(PickupCredit.amount(12, 12, false)).isZero();
    assertThat(PickupCredit.amount(12, 0, true)).isZero();
    assertThat(PickupCredit.amount(12, 15, false)).isZero();
  }
}
