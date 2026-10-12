package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import org.junit.jupiter.api.Test;

/** The bot's model of rwf's Rewinder: a 30 s cooldown and a 30 s trail. */
final class RewindClockTest {

  @Test
  void theClockStartsOnCooldownWhenTheMatchIsFirstSeen() {
    var clock = RewindClock.UNSTARTED.track(new Vec3(0, 0, 0), 100);
    assertThat(clock.readyAt()).isEqualTo(100 + RewindClock.COOLDOWN_TICKS);
    assertThat(clock.ready(100 + RewindClock.COOLDOWN_TICKS - 1)).isFalse();
    assertThat(clock.ready(100 + RewindClock.COOLDOWN_TICKS)).isTrue();
  }

  @Test
  void itLandsWhereTheBotStoodAboutThirtySecondsAgo() {
    var clock = RewindClock.UNSTARTED;
    for (var tick = 0L; tick <= 1200; tick += 5) {
      clock = clock.track(new Vec3(tick, 0, 0), tick);
    }
    var landing = clock.landing().orElseThrow().x();
    assertThat(landing)
        .isBetween(1200.0 - RewindClock.WINDOW_TICKS - RewindClock.SAMPLE_TICKS, 600.0);
  }

  @Test
  void usingItSpendsTheTrailAndRestartsTheCooldown() {
    var clock = RewindClock.UNSTARTED.track(new Vec3(1, 0, 0), 0).track(new Vec3(2, 0, 0), 700);
    assertThat(clock.ready(700)).isTrue();
    var used = clock.used(700);
    assertThat(used.ready(1299)).isFalse();
    assertThat(used.landing()).isEmpty();
    assertThat(used.track(new Vec3(3, 0, 0), 1300).ready(1300)).isTrue();
  }
}
