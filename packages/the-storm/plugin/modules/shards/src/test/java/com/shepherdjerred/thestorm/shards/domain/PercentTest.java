package com.shepherdjerred.thestorm.shards.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

final class PercentTest {

  @ParameterizedTest
  @CsvSource({
    "0.25,25%",
    "0.1,10%",
    "0.035,3.5%",
    "0.04,4%",
    "0.012,1.2%",
    "0.0,0%",
    "0.06000000000000001,6%"
  })
  void formatsFractionsForPlayers(double fraction, String text) {
    assertThat(Percent.format(fraction)).isEqualTo(text);
  }
}
