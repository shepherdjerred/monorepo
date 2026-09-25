package com.shepherdjerred.thestorm.essentials.domain.teleport;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

final class TeleportPricerTest {

  static final Instant T0 = Instant.parse("2026-09-25T12:00:00Z");
  static final Duration DECAY_EVERY = Duration.ofMinutes(10);

  static TeleportPricing pricing() {
    var price = new TeleportPrice(25, Duration.ofSeconds(60));
    return new TeleportPricing(
        new TeleportPrices(
            new TeleportPrice(10, Duration.ofSeconds(30)), price, price, price, price),
        0.5,
        0.5,
        DECAY_EVERY,
        4.0);
  }

  final TeleportPricer pricer = new TeleportPricer(pricing());

  static Optional<TeleportUsage> used(double multiplier, Instant at) {
    return Optional.of(new TeleportUsage(Multiplier.of(multiplier), at, at));
  }

  Quote quote(Optional<TeleportUsage> usage, Instant now) {
    return switch (pricer.quote(TeleportKind.HOME, usage, Exemptions.NONE, now)) {
      case Result.Ok<Quote, OnCooldown>(var quote) -> quote;
      case Result.Err<Quote, OnCooldown>(var error) -> throw new AssertionError(error);
    };
  }

  @Test
  void firstUseCostsTheBasePrice() {
    var quote = quote(Optional.empty(), T0);

    assertThat(quote.cost()).isEqualTo(25);
    assertThat(quote.multiplier()).isEqualTo(Multiplier.ONE);
    assertThat(quote.next())
        .isEqualTo(new TeleportUsage(Multiplier.of(1.5), T0, T0.plusSeconds(60)));
  }

  @Test
  void eachKindHasItsOwnBasePrice() {
    var spawn = pricer.quote(TeleportKind.SPAWN, Optional.empty(), Exemptions.NONE, T0);

    assertThat(spawn.map(Quote::cost)).isEqualTo(Result.ok(10L));
    assertThat(spawn.map(q -> q.next().cooldownUntil())).isEqualTo(Result.ok(T0.plusSeconds(30)));
  }

  @Test
  void repeatedUseGrowsCostAndCooldownUntilTheCap() {
    var usage = Optional.<TeleportUsage>empty();
    var now = T0;
    var costs = new long[8];
    for (var i = 0; i < costs.length; i++) {
      var quote = quote(usage, now);
      costs[i] = quote.cost();
      usage = Optional.of(quote.next());
      now = quote.next().cooldownUntil();
    }

    // x1, x1.5, x2, x2.5, x3, x3.5, x4, then capped at x4.
    assertThat(costs).containsExactly(25, 38, 50, 63, 75, 88, 100, 100);
    assertThat(usage.orElseThrow().multiplier()).isEqualTo(Multiplier.of(4));
  }

  @Test
  void cooldownScalesWithTheMultiplier() {
    var quote = quote(used(2.5, T0.minus(Duration.ofMinutes(5))), T0);

    assertThat(quote.multiplier()).isEqualTo(Multiplier.of(2.5));
    assertThat(quote.next().cooldownUntil()).isEqualTo(T0.plusSeconds(150));
  }

  @ParameterizedTest(name = "{0} after the last use, x3 decays to x{1}")
  @CsvSource({
    "PT0S, 3.0",
    "PT9M59.999S, 3.0",
    "PT10M, 2.5",
    "PT19M59.999S, 2.5",
    "PT20M, 2.0",
    "PT39M59.999S, 1.5",
    "PT40M, 1.0",
    "PT50M, 1.0",
    "P365D, 1.0"
  })
  void multiplierDecaysOneStepPerWholePeriod(Duration elapsed, double expected) {
    var multiplier = pricer.currentMultiplier(used(3, T0), T0.plus(elapsed));

    assertThat(multiplier).isEqualTo(Multiplier.of(expected));
  }

  @Test
  void aNeverUsedKindIsAtOne() {
    assertThat(pricer.currentMultiplier(Optional.empty(), T0)).isEqualTo(Multiplier.ONE);
  }

  @Test
  void aClockThatWentBackwardsDoesNotDecay() {
    assertThat(pricer.currentMultiplier(used(3, T0), T0.minusSeconds(60)))
        .isEqualTo(Multiplier.of(3));
  }

  @Test
  void decayAppliesBeforeGrowth() {
    var quote = quote(used(3, T0), T0.plus(Duration.ofMinutes(20)));

    assertThat(quote.multiplier()).isEqualTo(Multiplier.of(2));
    assertThat(quote.cost()).isEqualTo(50);
    assertThat(quote.next().multiplier()).isEqualTo(Multiplier.of(2.5));
  }

  @Test
  void refusesDuringTheCooldownAndAllowsExactlyAtItsEnd() {
    var usage = Optional.of(new TeleportUsage(Multiplier.of(1.5), T0, T0.plusSeconds(60)));

    var early = pricer.quote(TeleportKind.HOME, usage, Exemptions.NONE, T0.plusMillis(59_999));
    var onTime = pricer.quote(TeleportKind.HOME, usage, Exemptions.NONE, T0.plusSeconds(60));

    assertThat(early)
        .isEqualTo(Result.err(new OnCooldown(TeleportKind.HOME, Duration.ofMillis(1))));
    assertThat(onTime.isOk()).isTrue();
  }

  @Test
  void freeExemptionCostsNothingButStillGrowsTheMultiplier() {
    var quote =
        pricer.quote(
            TeleportKind.HOME, used(2, T0), new Exemptions(true, false), T0.plusSeconds(1));

    assertThat(quote.map(Quote::cost)).isEqualTo(Result.ok(0L));
    assertThat(quote.map(q -> q.next().multiplier())).isEqualTo(Result.ok(Multiplier.of(2.5)));
  }

  @Test
  void cooldownExemptionIgnoresAndSetsNoCooldown() {
    var usage = Optional.of(new TeleportUsage(Multiplier.ONE, T0, T0.plusSeconds(60)));

    var quote = pricer.quote(TeleportKind.HOME, usage, new Exemptions(false, true), T0);

    assertThat(quote.map(q -> q.next().cooldownUntil())).isEqualTo(Result.ok(T0));
    assertThat(quote.map(Quote::cost)).isEqualTo(Result.ok(25L));
  }

  @Test
  void aFreeKindStaysFree() {
    var free = new TeleportPrice(0, Duration.ZERO);
    var pricing =
        new TeleportPricing(
            new TeleportPrices(free, free, free, free, free), 0.5, 0.5, DECAY_EVERY, 4.0);

    var quote =
        new TeleportPricer(pricing).quote(TeleportKind.WARP, used(4, T0), Exemptions.NONE, T0);

    assertThat(quote.map(Quote::cost)).isEqualTo(Result.ok(0L));
  }
}
