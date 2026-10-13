package com.shepherdjerred.thestorm.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

final class FramePacingClockTest {
  private static final FramePacingClock.Camera CAMERA = new FramePacingClock.Camera(1, 2, 3, 0, 0);

  @Test
  void measuresEveryActualIntervalAndRetainsAStallInsteadOfSamplingAverageFps() {
    var clock = new FramePacingClock(0, 1000, 5);
    for (var time : new long[] {0, 16_000_000, 32_000_000, 82_000_000, 98_000_000})
      clock.rendered(time, new FramePacingClock.RenderObservation(3, true, false, 120, CAMERA));
    assertThat(clock.complete()).isTrue();
    assertThat(clock.completion()).isEqualTo("FRAME_LIMIT");
    assertThat(clock.observations())
        .extracting(FramePacingClock.Observation::intervalNanos)
        .containsExactly(0L, 16_000_000L, 16_000_000L, 50_000_000L, 16_000_000L);
    assertThat(clock.quantiles())
        .isEqualTo(
            new FramePacingClock.Quantiles(
                4, 24_500_000, 16_000_000, 50_000_000, 50_000_000, 50_000_000));
    assertThat(clock.tailNanos()).isZero();
  }

  @Test
  void boundedDeadlineRetainsUnrenderedTailWithoutInventingFrames() {
    var clock = new FramePacingClock(0, 60, 100);
    clock.rendered(0, new FramePacingClock.RenderObservation(0, true, false, 120, CAMERA));
    clock.rendered(16_000_000, new FramePacingClock.RenderObservation(0, false, true, 10, CAMERA));
    clock.tick(80_000_000);
    clock.rendered(90_000_000, new FramePacingClock.RenderObservation(1, true, false, 120, CAMERA));
    assertThat(clock.frames()).isEqualTo(2);
    assertThat(clock.observedElapsedNanos()).isEqualTo(80_000_000);
    assertThat(clock.measuredDurationNanos()).isEqualTo(60_000_000);
    assertThat(clock.tailNanos()).isEqualTo(44_000_000);
    assertThat(clock.observations().getLast().focused()).isFalse();
    assertThat(clock.observations().getLast().screenOpen()).isTrue();
  }

  @Test
  void rejectsNonmonotonicFramesAndInvalidWindowsAndRetainsInterruptedTime() {
    assertThatThrownBy(() -> new FramePacingClock(0, 60_001, 2))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new FramePacingClock(0, 60, 1))
        .isInstanceOf(IllegalArgumentException.class);
    var clock = new FramePacingClock(0, 60, 100);
    clock.rendered(10, new FramePacingClock.RenderObservation(0, true, false, 120, CAMERA));
    assertThatThrownBy(
            () ->
                clock.rendered(
                    10, new FramePacingClock.RenderObservation(0, true, false, 120, CAMERA)))
        .isInstanceOf(IllegalArgumentException.class);
    clock.interrupted(30);
    assertThat(clock.completion()).isEqualTo("INTERRUPTED");
    assertThat(clock.tailNanos()).isEqualTo(20);
    assertThatThrownBy(clock::quantiles).isInstanceOf(IllegalStateException.class);
  }
}
