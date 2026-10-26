package com.shepherdjerred.thestorm.essentials.domain.teleport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import java.time.Duration;
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
  void pricesMustBeValid() {
    assertThatThrownBy(() -> new TeleportPrice(-1, Duration.ZERO))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new TeleportPrice(1, Duration.ofSeconds(-1)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void theFreePeriodMustNotBeNegative() {
    var prices = TeleportPricerTest.pricing().prices();
    assertThatThrownBy(() -> new TeleportPricing(prices, Duration.ofSeconds(-1)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(new TeleportPricing(prices, Duration.ZERO).rtpFreeFor()).isZero();
  }

  @Test
  void quotesAndCooldownRefusalsCannotBeNegative() {
    assertThatThrownBy(() -> new Quote(TeleportKind.HOME, -1, Duration.ZERO))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Quote(TeleportKind.HOME, 0, Duration.ofSeconds(-1)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new OnCooldown(TeleportKind.HOME, Duration.ZERO))
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
