package com.shepherdjerred.thestorm.rwfbots.domain.difficulty;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Map;
import org.junit.jupiter.api.Test;

final class LeverCurvesTest {

  @Test
  void everyLeverIsMonotoneInSkill() {
    for (var lever : Lever.values()) {
      var previous = LeverCurves.at(0).get(lever);
      for (var step = 1; step <= 100; step++) {
        var value = LeverCurves.at(step / 100.0).get(lever);
        if (lever.lowerIsBetter()) {
          assertThat(value).as(lever.key()).isLessThanOrEqualTo(previous);
        } else {
          assertThat(value).as(lever.key()).isGreaterThanOrEqualTo(previous);
        }
        previous = value;
      }
      assertThat(LeverCurves.at(0).get(lever)).isEqualTo(lever.worst());
      assertThat(LeverCurves.at(1).get(lever)).isEqualTo(lever.best());
    }
  }

  @Test
  void offsetsMoveTowardsStrongerAndStayInRange() {
    var offsets = new LeverOffsets(Map.of(Lever.AIM_ERROR_DEG, 1.0, Lever.CPS, 3.0));
    var base = LeverCurves.at(0.5);
    var shifted = LeverCurves.at(0.5, offsets);
    assertThat(shifted.aimErrorDeg()).isLessThan(base.aimErrorDeg());
    assertThat(shifted.cps()).isGreaterThan(base.cps()).isLessThanOrEqualTo(Lever.CPS.max());
    assertThat(LeverCurves.at(1, offsets).cps()).isEqualTo(Lever.CPS.max());
  }

  @Test
  void matchShiftMovesSkillAndClamps() {
    var up = LeverCurves.effective(0.5, LeverOffsets.NONE, 0.2);
    assertThat(up).isEqualTo(LeverCurves.at(0.7));
    assertThat(LeverCurves.effective(0.9, LeverOffsets.NONE, 0.5)).isEqualTo(LeverCurves.at(1));
  }

  @Test
  void leversRejectOutOfRangeValues() {
    assertThatThrownBy(() -> LeverCurves.at(0.5).with(Lever.CPS, 13))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> LeverCurves.at(1.5)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void offsetsRejectUnknownKeysAndWildValues() {
    assertThatThrownBy(() -> LeverOffsets.parse(Map.of("reactionMs", 1.0, "swagger", 2.0)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("swagger");
    assertThatThrownBy(() -> LeverOffsets.parse(Map.of("cps", 4.0)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(
            LeverOffsets.parse(Map.of("turnRateDegPerTick", -1.5)).z(Lever.TURN_RATE_DEG_PER_TICK))
        .isEqualTo(-1.5);
  }
}
