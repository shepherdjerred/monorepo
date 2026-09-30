package com.shepherdjerred.thestorm.world.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

final class CrierNewsTest {

  @Test
  void reportsWeatherAndTimeFromTheRequestedWorldState() {
    assertThat(CrierNews.bulletin(0, 0, false, false).getFirst())
        .isEqualTo("Hear ye! In the main world this morning, the skies are clear.");
    assertThat(CrierNews.bulletin(12_000, 12_000, true, false).getFirst())
        .isEqualTo("Hear ye! In the main world this evening, rain falls.");
    assertThat(CrierNews.bulletin(18_000, 18_000, true, true).getFirst())
        .isEqualTo("Hear ye! In the main world this night, thunder rolls.");
    assertThat(CrierNews.bulletin(18_000, 18_000, false, true).getFirst())
        .isEqualTo("Hear ye! In the main world this night, thunder rolls.");
  }

  @Test
  void rotatesHistoricalNotesByGameDayWithoutAScheduledJob() {
    var first = CrierNews.bulletin(0, 0, false, false).get(1);
    assertThat(first).contains("blacksmith", "windmill");
    assertThat(CrierNews.bulletin(24_000, 0, false, false).get(1)).contains("Bridge Hobo");
    assertThat(CrierNews.bulletin(48_000, 0, false, false).get(1)).contains("21 eggs");
    assertThat(CrierNews.bulletin(72_000, 0, false, false).get(1)).contains("Braxton");
    assertThat(CrierNews.bulletin(96_000, 0, false, false).get(1)).isEqualTo(first);
  }

  @Test
  void rejectsImpossibleClockSnapshots() {
    assertThatThrownBy(() -> CrierNews.bulletin(-1, 0, false, false))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> CrierNews.bulletin(0, 24_000, false, false))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
