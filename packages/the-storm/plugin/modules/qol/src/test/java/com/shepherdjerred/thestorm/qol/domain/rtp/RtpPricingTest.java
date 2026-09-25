package com.shepherdjerred.thestorm.qol.domain.rtp;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class RtpPricingTest {

  private final RtpPricing pricing = new RtpPricing(Duration.ofDays(7), Duration.ofSeconds(15), 25);
  private final Instant first = Instant.parse("2026-09-01T00:00:00Z");

  @Test
  void theFirstWeekIsFreeButStillWaits() {
    var now = first.plus(Duration.ofDays(1));
    assertThat(pricing.decide(first, Optional.empty(), now)).isInstanceOf(RtpDecision.Free.class);
    var cooling = pricing.decide(first, Optional.of(now), now.plusSeconds(5));
    assertThat(cooling).isInstanceOf(RtpDecision.CoolingDown.class);
  }

  @Test
  void afterTheWeekItCostsCrystals() {
    var now = first.plus(Duration.ofDays(8));
    assertThat(pricing.decide(first, Optional.empty(), now)).isEqualTo(new RtpDecision.Priced(25));
  }
}
