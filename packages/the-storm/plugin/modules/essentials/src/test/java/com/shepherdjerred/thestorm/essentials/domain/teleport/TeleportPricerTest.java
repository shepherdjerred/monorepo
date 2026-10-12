package com.shepherdjerred.thestorm.essentials.domain.teleport;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

final class TeleportPricerTest {
  static final Instant T0 = Instant.parse("2026-09-25T12:00:00Z");
  static final Duration WINDOW = Duration.ofHours(1);

  static TeleportPricing pricing() {
    var normal = new TeleportPrice(25, Duration.ofMinutes(1), 1);
    return new TeleportPricing(
        new TeleportPrices(
            new TeleportPrice(10, Duration.ofSeconds(30), .5), normal,
            new TeleportPrice(25, Duration.ofMinutes(1), 2), normal,
            new TeleportPrice(15, Duration.ofSeconds(30), .5), normal),
        WINDOW,
        4,
        32,
        Duration.ofDays(7));
  }

  final TeleportPricer pricer = new TeleportPricer(pricing());

  static TeleportUsage homes(int count, Instant at) {
    return new TeleportUsage(
        IntStream.range(0, count).mapToObj(i -> new TeleportUse(at, 2)).toList(), T0);
  }

  Quote quote(TeleportKind kind, TeleportUsage usage, Instant now) {
    return pricer
        .quote(kind, Optional.of(usage), Exemptions.NONE, now)
        .fold(
            value -> value,
            error -> {
              throw new AssertionError(error);
            });
  }

  @ParameterizedTest
  @CsvSource({
    "0,1,25,60",
    "1,1,25,60",
    "2,1,25,60",
    "3,1,25,60",
    "4,2,50,120",
    "5,4,100,240",
    "6,8,200,480",
    "7,16,400,960",
    "8,32,800,1920",
    "40,32,800,1920"
  })
  void fourNormalTripsAreForgivingThenBothPriceAndCooldownDouble(
      int previous, double multiplier, long cost, long seconds) {
    var quoted = quote(TeleportKind.HOME, homes(previous, T0.minusSeconds(1)), T0);
    assertThat(quoted.multiplier()).isEqualTo(Multiplier.of(multiplier));
    assertThat(quoted.cost()).isEqualTo(cost);
    assertThat(quoted.cooldown()).isEqualTo(Duration.ofSeconds(seconds));
    assertThat(quoted.next().trips()).hasSize(previous + 1);
  }

  @Test
  void playerToPlayerTravelUsesTwiceTheAllowance() {
    var history =
        new TeleportUsage(
            List.of(
                new TeleportUse(T0.minusSeconds(120), 4), new TeleportUse(T0.minusSeconds(60), 4)),
            T0);
    var third = quote(TeleportKind.TPA, history, T0);
    assertThat(third.cost()).isEqualTo(100);
    assertThat(third.multiplier()).isEqualTo(Multiplier.of(4));
    assertThat(third.cooldown()).isEqualTo(Duration.ofMinutes(4));
  }

  @ParameterizedTest
  @CsvSource({"7,1", "8,2", "9,2", "10,4"})
  void halfPointTripsCrossTheAllowanceWithoutFractionalEscalation(int previous, double expected) {
    var trips = IntStream.range(0, previous).mapToObj(i -> new TeleportUse(T0, 1)).toList();
    var quoted = quote(TeleportKind.SPAWN, new TeleportUsage(trips, T0), T0);
    assertThat(quoted.multiplier()).isEqualTo(Multiplier.of(expected));
  }

  @Test
  void mixedCategoriesShareTheSamePressure() {
    var history =
        new TeleportUsage(
            List.of(
                new TeleportUse(T0, 1), new TeleportUse(T0, 1),
                new TeleportUse(T0, 2), new TeleportUse(T0, 2)),
            T0);
    assertThat(quote(TeleportKind.TPA, history, T0).cost()).isEqualTo(50);
    assertThat(quote(TeleportKind.RTP, history, T0).cost()).isEqualTo(25);
  }

  @ParameterizedTest
  @CsvSource({"PT59M59.999S,2", "PT1H,1", "PT1H1S,1", "P365D,1"})
  void tripsExpireExactlyAtTheWindowBoundary(Duration elapsed, double expected) {
    var history = homes(4, T0);
    var quoted = quote(TeleportKind.RTP, history, T0.plus(elapsed));
    assertThat(quoted.multiplier()).isEqualTo(Multiplier.of(expected));
  }

  @Test
  void tripsExpireIndividuallyRatherThanAtAnHourlyReset() {
    var history =
        new TeleportUsage(
            List.of(
                new TeleportUse(T0.minusSeconds(3600), 4),
                new TeleportUse(T0.minusSeconds(3599), 4)),
            T0);
    var quoted = quote(TeleportKind.TPA, history, T0);
    assertThat(quoted.previousPoints()).isEqualTo(2);
    assertThat(quoted.cost()).isEqualTo(25);
  }

  @Test
  void cooldownAppliesToEveryCategoryAndAllowsExactlyAtItsEnd() {
    var history = new TeleportUsage(List.of(new TeleportUse(T0, 2)), T0.plusSeconds(60));
    for (var kind : TeleportKind.values()) {
      assertThat(pricer.quote(kind, Optional.of(history), Exemptions.NONE, T0.plusMillis(59999)))
          .isEqualTo(Result.err(new OnCooldown(kind, Duration.ofMillis(1))));
      assertThat(
              pricer.quote(kind, Optional.of(history), Exemptions.NONE, T0.plusSeconds(60)).isOk())
          .isTrue();
    }
  }

  @Test
  void freeTripsKeepTheirEscalatingCooldownAndWeight() {
    var result =
        pricer.quote(TeleportKind.RTP, Optional.of(homes(4, T0)), new Exemptions(true, false), T0);
    var quoted =
        result.fold(
            value -> value,
            error -> {
              throw new AssertionError(error);
            });
    assertThat(quoted.cost()).isZero();
    assertThat(quoted.cooldown()).isEqualTo(Duration.ofMinutes(2));
    assertThat(quoted.next().trips()).hasSize(5);
  }

  @Test
  void cooldownExemptionStillRecordsUsage() {
    var history = new TeleportUsage(homes(4, T0).trips(), T0.plusSeconds(60));
    var quoted =
        pricer
            .quote(TeleportKind.HOME, Optional.of(history), new Exemptions(false, true), T0)
            .fold(
                value -> value,
                error -> {
                  throw new AssertionError(error);
                });
    assertThat(quoted.cost()).isEqualTo(50);
    assertThat(quoted.cooldown()).isZero();
    assertThat(quoted.next().trips()).hasSize(5);
  }

  @Test
  void clockMovingBackDoesNotEraseRecentUsage() {
    var quoted =
        pricer.preview(TeleportKind.HOME, homes(4, T0), Exemptions.NONE, T0.minusSeconds(1));
    assertThat(quoted.cost()).isEqualTo(50);
  }

  @Test
  void cooldownAndWindowStartOnArrivalRatherThanQuotation() {
    var quoted = quote(TeleportKind.HOME, TeleportUsage.EMPTY, T0);
    var delivered = quoted.next().deliveredAt(T0.plusSeconds(20));
    assertThat(delivered.trips().getLast().at()).isEqualTo(T0.plusSeconds(20));
    assertThat(delivered.cooldownUntil()).isEqualTo(T0.plusSeconds(80));
    assertThat(TeleportUsage.EMPTY.trips()).isEmpty();
  }
}
