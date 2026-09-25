package com.shepherdjerred.thestorm.tracks.domain;

import static com.shepherdjerred.thestorm.tracks.domain.Progressions.DEFAULT_PRICING;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

final class PricingTest {

  @ParameterizedTest(name = "level {0} at position {1} costs {2}")
  @CsvSource({
    // The primary pays the base price.
    "1, 0, 1000",
    "2, 0, 2500",
    "3, 0, 5000",
    "4, 0, 10000",
    "5, 0, 20000",
    // The second track costs half again.
    "1, 1, 1500",
    "2, 1, 3750",
    "3, 1, 7500",
    "4, 1, 15000",
    "5, 1, 30000",
    // Then double, triple and four times.
    "1, 2, 2000",
    "5, 2, 40000",
    "1, 3, 3000",
    "5, 3, 60000",
    "1, 4, 4000",
    "3, 4, 20000",
    "5, 4, 80000",
  })
  void theDefaultPricesMatchThePlan(int level, int position, long cost) {
    assertThat(DEFAULT_PRICING.cost(level, position)).isEqualTo(cost);
  }

  @Test
  void pricesRoundHalfUpToWholeCrystals() {
    var pricing =
        new Pricing(
            List.of(1_001L, 3L, 5L, 7L, 9L),
            List.of(
                BigDecimal.ONE,
                new BigDecimal("1.5"),
                new BigDecimal("1.25"),
                new BigDecimal("1.1"),
                new BigDecimal("1.3333")));

    assertThat(pricing.cost(1, 1)).isEqualTo(1_502); // 1501.5
    assertThat(pricing.cost(2, 1)).isEqualTo(5); // 4.5
    assertThat(pricing.cost(2, 2)).isEqualTo(4); // 3.75
    assertThat(pricing.cost(3, 3)).isEqualTo(6); // 5.5
    assertThat(pricing.cost(4, 4)).isEqualTo(9); // 9.3331
    assertThat(pricing.cost(5, 2)).isEqualTo(11); // 11.25
  }

  @Test
  void levelsAndPositionsOutsideTheTableAreRejected() {
    assertThatThrownBy(() -> DEFAULT_PRICING.cost(0, 0))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> DEFAULT_PRICING.cost(6, 0))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> DEFAULT_PRICING.cost(1, -1))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> DEFAULT_PRICING.cost(1, 5))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void theTablesMustBeComplete() {
    var multipliers = DEFAULT_PRICING.orderMultipliers();
    assertThatThrownBy(() -> new Pricing(List.of(1L, 2L, 3L, 4L), multipliers))
        .hasMessageContaining("one cost per level");
    assertThatThrownBy(() -> new Pricing(DEFAULT_PRICING.baseCosts(), multipliers.subList(0, 4)))
        .hasMessageContaining("one multiplier per track");
  }

  @Test
  void pricesMustBePositiveAndMultipliersAtLeastOne() {
    var multipliers = DEFAULT_PRICING.orderMultipliers();
    assertThatThrownBy(() -> new Pricing(List.of(0L, 2L, 3L, 4L, 5L), multipliers))
        .hasMessageContaining("at least 1");
    assertThatThrownBy(
            () ->
                new Pricing(
                    DEFAULT_PRICING.baseCosts(),
                    List.of(
                        BigDecimal.ONE,
                        new BigDecimal("0.99"),
                        BigDecimal.TWO,
                        BigDecimal.TWO,
                        BigDecimal.TWO)))
        .hasMessageContaining("at least 1");
  }
}
