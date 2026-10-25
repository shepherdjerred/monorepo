package com.shepherdjerred.thestorm.creative.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Set;
import org.junit.jupiter.api.Test;

/** Visitor flags are a fixed set and default off. */
final class PlotFlagTest {

  @Test
  void unknownNamesFailAndEveryFlagStartsOff() {
    assertThat(PlotFlag.parse("fly")).isEmpty();
    assertThatThrownBy(() -> PlotFlag.require("fly"))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("unknown creative flag: fly");

    for (var flag : PlotFlag.values()) {
      assertThat(PlotFlag.parse(flag.stored())).contains(flag);
      assertThat(PlotFlag.visitorMay(false, Set.of(), flag)).isFalse();
      assertThat(PlotFlag.visitorMay(true, Set.of(), flag)).isTrue();
    }
    assertThat(PlotFlag.visitorMay(false, Set.of(PlotFlag.USE), PlotFlag.USE)).isTrue();
    assertThat(PlotFlag.visitorMay(false, Set.of(PlotFlag.USE), PlotFlag.PVP)).isFalse();
    assertThat(PlotFlag.explosionMay(false, true, Set.of(PlotFlag.EXPLOSION))).isFalse();
    assertThat(PlotFlag.explosionMay(true, true, Set.of())).isFalse();
    assertThat(PlotFlag.explosionMay(true, true, Set.of(PlotFlag.EXPLOSION))).isTrue();
    assertThat(PlotFlag.explosionMay(true, false, Set.of())).isTrue();
  }
}
