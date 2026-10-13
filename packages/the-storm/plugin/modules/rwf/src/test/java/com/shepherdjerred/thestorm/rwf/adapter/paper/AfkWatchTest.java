package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import org.bukkit.Location;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

final class AfkWatchTest {

  @ParameterizedTest
  @CsvSource({
    "260.90973, -99.09027, false",
    "-99.09027, 260.90973, false",
    "180, -180, false",
    "-180, 180, false",
    "359.8, 0.2, true",
    "179.8, -179.8, true",
    "0.2, 0.9, false",
    "0.9, 1.1, true",
    "-0.2, 0.2, false"
  })
  void equivalentYawIsIdleAndWholeDegreeTurnsAreActivity(
      float fromYaw, float toYaw, boolean activity) {
    var from = new Location(null, 0, 0, 0, fromYaw, 0);
    var to = new Location(null, 0, 0, 0, toYaw, 0);

    assertThat(AfkWatch.turned(from, to)).isEqualTo(activity);
  }

  @ParameterizedTest
  @CsvSource({"0.2, 0.9, false", "0.9, 1.1, true"})
  void wholeDegreePitchTurnsAreActivity(float fromPitch, float toPitch, boolean activity) {
    var from = new Location(null, 0, 0, 0, 0, fromPitch);
    var to = new Location(null, 0, 0, 0, 0, toPitch);

    assertThat(AfkWatch.turned(from, to)).isEqualTo(activity);
  }
}
