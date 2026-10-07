package com.shepherdjerred.thestorm.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class FrameClockTest {
  @Test
  void SamplesRenderedFramesOncePerSlotWithoutAccumulatingRoundingDrift() {
    var clock = new FrameClock(900);
    var start = 123456789L;
    for (int i = 0; i < 900; i++) {
      var due = start + i * FrameClock.SECOND / FrameClock.FPS;
      assertThat(clock.sample(due)).isTrue();
      assertThat(clock.sample(due)).isFalse();
    }
    assertThat(clock.complete()).isTrue();
    assertThat(clock.frames()).isEqualTo(900);
    assertThat(clock.elapsed(start + FrameClock.SECOND * 30)).isEqualTo(FrameClock.SECOND * 30);
  }

  @Test
  void MissedSlotsCannotBeFilledByRepeatingACurrentFrame() {
    var clock = new FrameClock(900);
    assertThat(clock.sample(0)).isTrue();
    assertThatThrownBy(() -> clock.sample(2 * FrameClock.SECOND / FrameClock.FPS))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("missed frame 1");
    assertThat(clock.frames()).isEqualTo(1);
  }

  @Test
  void CapsTheCaptureAtOneMinute() {
    assertThatThrownBy(() -> new FrameClock(0)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new FrameClock(1801)).isInstanceOf(IllegalArgumentException.class);
    assertThat(new FrameClock(1800).complete()).isFalse();
  }
}
