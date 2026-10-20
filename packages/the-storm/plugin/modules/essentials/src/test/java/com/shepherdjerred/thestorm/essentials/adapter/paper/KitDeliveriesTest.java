package com.shepherdjerred.thestorm.essentials.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

final class KitDeliveriesTest {

  @Test
  void aKitStaysPendingInsideASealedWorld() {
    assertThat(KitDeliveries.withholds(true)).isTrue();
    assertThat(KitDeliveries.withholds(false)).isFalse();
  }
}
