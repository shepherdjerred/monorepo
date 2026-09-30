package com.shepherdjerred.thestorm.shards.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

final class StormTierTest {

  @ParameterizedTest
  @CsvSource({"1,I", "2,II", "3,III", "4,IV", "5,V"})
  void tiersReadAsRomanNumerals(int level, String numeral) {
    assertThat(new StormTier(level).numeral()).isEqualTo(numeral);
    assertThat(new StormTier(level).index()).isEqualTo(level - 1);
  }

  @ParameterizedTest
  @ValueSource(ints = {0, -1, 6, 100})
  void tiersOutsideOneToFiveAreCorrupt(int level) {
    assertThatThrownBy(() -> new StormTier(level)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void anUnupgradedItemGoesToStormOne() {
    assertThat(StormTier.after(Optional.empty())).contains(StormTier.first());
  }

  @Test
  void eachTierLeadsToTheNext() {
    assertThat(StormTier.after(Optional.of(new StormTier(3)))).contains(new StormTier(4));
  }

  @Test
  void stormFiveHasNoNextTier() {
    assertThat(new StormTier(5).next()).isEmpty();
    assertThat(StormTier.after(Optional.of(new StormTier(5)))).isEmpty();
  }
}
