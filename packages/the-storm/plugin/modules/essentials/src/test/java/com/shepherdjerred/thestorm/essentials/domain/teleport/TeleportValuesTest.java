package com.shepherdjerred.thestorm.essentials.domain.teleport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;

final class TeleportValuesTest {
  @Test
  void kindsRoundTripAndUnknownKindsFail() {
    for (var kind : TeleportKind.values()) {
      assertThat(TeleportKind.fromId(kind.id())).isEqualTo(kind);
    }
    assertThatThrownBy(() -> TeleportKind.fromId("unknown"))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void pricesAndWeightsMustBeValid() {
    assertThatThrownBy(() -> new TeleportPrice(-1, Duration.ZERO, 1))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new TeleportPrice(1, Duration.ofSeconds(-1), 1))
        .isInstanceOf(IllegalArgumentException.class);
    for (var weight : new double[] {0, -.5, .25, Double.NaN, Double.POSITIVE_INFINITY}) {
      assertThatThrownBy(() -> new TeleportPrice(1, Duration.ZERO, weight))
          .isInstanceOf(IllegalArgumentException.class);
    }
    assertThat(new TeleportPrice(1, Duration.ZERO, .5).halfPoints()).isEqualTo(1);
  }

  @Test
  void policyRequiresValidWindowAllowanceCapAndFreePeriod() {
    var prices = TeleportPricerTest.pricing().prices();
    assertThatThrownBy(() -> new TeleportPricing(prices, Duration.ZERO, 4, 32, Duration.ZERO))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () -> new TeleportPricing(prices, Duration.ofHours(1), .25, 32, Duration.ZERO))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () -> new TeleportPricing(prices, Duration.ofHours(1), Double.NaN, 32, Duration.ZERO))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new TeleportPricing(prices, Duration.ofHours(1), 4, .5, Duration.ZERO))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () -> new TeleportPricing(prices, Duration.ofHours(1), 4, 32, Duration.ofSeconds(-1)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void quotesAndCooldownRefusalsCannotBeNegative() {
    assertThatThrownBy(() -> new Quote(TeleportKind.HOME, -1, Multiplier.ONE, TeleportUsage.EMPTY))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new OnCooldown(TeleportKind.HOME, Duration.ZERO))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new TeleportUse(Instant.EPOCH, 0))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void warmupIgnoresLookingAroundAndMovingWithinTheBlock() {
    var start = new Position("world", 10.2, 64, -3.9, 0, 0);
    assertThat(Warmup.interruptedBy(start, new Position("world", 10.9, 64.5, -3.1, 90, 45)))
        .isFalse();
  }

  @Test
  void warmupCancelsOnAnotherBlockOrWorld() {
    var start = new Position("world", 10.2, 64, -3.9, 0, 0);
    assertThat(Warmup.interruptedBy(start, new Position("world", 11.0, 64, -3.9, 0, 0))).isTrue();
    assertThat(Warmup.interruptedBy(start, new Position("world", 10.2, 65, -3.9, 0, 0))).isTrue();
    assertThat(Warmup.interruptedBy(start, new Position("world", 10.2, 64, -4.01, 0, 0))).isTrue();
    assertThat(Warmup.interruptedBy(start, new Position("world", 10.2, 64, -3.0, 0, 0))).isTrue();
    assertThat(Warmup.interruptedBy(start, new Position("world", 10.2, 64, -4.0, 0, 0))).isFalse();
    assertThat(Warmup.interruptedBy(start, new Position("world_nether", 10.2, 64, -3.9, 0, 0)))
        .isTrue();
  }
}
