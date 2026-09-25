package com.shepherdjerred.thestorm.essentials.domain.teleport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.essentials.domain.place.Position;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

final class TeleportValuesTest {

  static final TeleportPrice PRICE = new TeleportPrice(25, Duration.ofMinutes(1));
  static final TeleportPrices PRICES = new TeleportPrices(PRICE, PRICE, PRICE, PRICE, PRICE);

  @EnumSource(TeleportKind.class)
  @ParameterizedTest
  void kindIdsRoundTrip(TeleportKind kind) {
    assertThat(TeleportKind.fromId(kind.id())).isEqualTo(kind);
    assertThat(kind.id()).isLowerCase();
  }

  @Test
  void unknownKindIdIsAnError() {
    assertThatThrownBy(() -> TeleportKind.fromId("tppos"))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void pricesAreLookedUpPerKind() {
    var spawn = new TeleportPrice(1, Duration.ZERO);
    var home = new TeleportPrice(2, Duration.ZERO);
    var tpa = new TeleportPrice(3, Duration.ZERO);
    var back = new TeleportPrice(4, Duration.ZERO);
    var warp = new TeleportPrice(5, Duration.ZERO);
    var prices = new TeleportPrices(spawn, home, tpa, back, warp);

    assertThat(prices.of(TeleportKind.SPAWN)).isEqualTo(spawn);
    assertThat(prices.of(TeleportKind.HOME)).isEqualTo(home);
    assertThat(prices.of(TeleportKind.TPA)).isEqualTo(tpa);
    assertThat(prices.of(TeleportKind.BACK)).isEqualTo(back);
    assertThat(prices.of(TeleportKind.WARP)).isEqualTo(warp);
  }

  @Test
  void pricesMustNotBeNegative() {
    assertThatThrownBy(() -> new TeleportPrice(-1, Duration.ZERO))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new TeleportPrice(1, Duration.ofSeconds(-1)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void pricingValidatesItsNumbers() {
    var every = Duration.ofMinutes(10);
    assertThatThrownBy(() -> new TeleportPricing(PRICES, -0.5, 0.5, every, 4))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new TeleportPricing(PRICES, 0.5, Double.NaN, every, 4))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new TeleportPricing(PRICES, 0.5, 0.5, every, 0.5))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new TeleportPricing(PRICES, 0.5, 0.5, Duration.ZERO, 4))
        .isInstanceOf(IllegalArgumentException.class);

    var pricing = new TeleportPricing(PRICES, 0.25, 0.1, every, 3);
    assertThat(pricing.growthStep()).isEqualTo(25);
    assertThat(pricing.decayStep()).isEqualTo(10);
    assertThat(pricing.cap()).isEqualTo(Multiplier.of(3));
  }

  @Test
  void usageCooldownCannotEndBeforeTheTeleport() {
    var t0 = Instant.parse("2026-09-25T12:00:00Z");
    assertThatThrownBy(() -> new TeleportUsage(Multiplier.ONE, t0, t0.minusMillis(1)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void cooldownRefusalsArePositive() {
    assertThatThrownBy(() -> new OnCooldown(TeleportKind.HOME, Duration.ZERO))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void quotesCannotBeNegative() {
    var t0 = Instant.parse("2026-09-25T12:00:00Z");
    var usage = new TeleportUsage(Multiplier.ONE, t0, t0);
    assertThatThrownBy(() -> new Quote(TeleportKind.HOME, -1, Multiplier.ONE, usage))
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
