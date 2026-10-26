package com.shepherdjerred.thestorm.essentials.domain.teleport;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;

final class TeleportPricerTest {
  static final Instant T0 = Instant.parse("2026-09-25T12:00:00Z");

  static TeleportPricing pricing() {
    var normal = new TeleportPrice(25, Duration.ofMinutes(1));
    return new TeleportPricing(
        new TeleportPrices(
            new TeleportPrice(10, Duration.ofSeconds(30)),
            normal,
            new TeleportPrice(25, Duration.ofMinutes(1)),
            normal,
            new TeleportPrice(15, Duration.ofSeconds(30)),
            normal),
        Duration.ofDays(7));
  }

  static Quote quote(TeleportKind kind, TeleportUsage usage, Exemptions exemptions) {
    return new TeleportPricer(pricing())
        .quote(kind, usage, exemptions, T0)
        .fold(
            quoted -> quoted,
            error -> {
              throw new AssertionError(error);
            });
  }

  @Test
  void aFreshPlayerPaysTheFlatPrice() {
    var quoted = quote(TeleportKind.HOME, TeleportUsage.EMPTY, Exemptions.NONE);
    assertThat(quoted.cost()).isEqualTo(25);
    assertThat(quoted.cooldown()).isEqualTo(Duration.ofMinutes(1));
  }

  @Test
  void oneKindDoesNotBlockAnother() {
    var usage = TeleportUsage.EMPTY.with(TeleportKind.HOME, T0.plusSeconds(60));
    var warp = quote(TeleportKind.WARP, usage, Exemptions.NONE);
    assertThat(warp.cost()).isEqualTo(15);
    assertThat(new TeleportPricer(pricing()).quote(TeleportKind.HOME, usage, Exemptions.NONE, T0))
        .isEqualTo(Result.err(new OnCooldown(TeleportKind.HOME, Duration.ofSeconds(60))));
  }

  @Test
  void aFreeExemptionZerosTheCostAndKeepsTheCooldown() {
    var quoted = quote(TeleportKind.RTP, TeleportUsage.EMPTY, new Exemptions(true, false));
    assertThat(quoted.cost()).isZero();
    assertThat(quoted.cooldown()).isEqualTo(Duration.ofMinutes(1));
  }

  @Test
  void ignoringCooldownZerosIt() {
    var usage = TeleportUsage.EMPTY.with(TeleportKind.HOME, T0.plusSeconds(60));
    var quoted = quote(TeleportKind.HOME, usage, new Exemptions(false, true));
    assertThat(quoted.cost()).isEqualTo(25);
    assertThat(quoted.cooldown()).isZero();
  }

  @Test
  void theCooldownEndsExactlyAtTheInstant() {
    var usage = TeleportUsage.EMPTY.with(TeleportKind.HOME, T0);
    var quoted = quote(TeleportKind.HOME, usage, Exemptions.NONE);
    assertThat(quoted.cost()).isEqualTo(25);
  }
}
