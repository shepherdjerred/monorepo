package com.shepherdjerred.thestorm.spells.domain.cast;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class TimersTest {

  private static final Instant NOW = Instant.parse("2026-09-25T12:00:00Z");
  private static final UUID ALICE = new UUID(0, 1);
  private static final UUID BOB = new UUID(0, 2);

  @Test
  void aTimerRunsForItsDurationAndThenStops() {
    var timers = new Timers<UUID>();
    timers.start(ALICE, Duration.ofSeconds(10), NOW);

    assertThat(timers.remaining(ALICE, NOW)).isEqualTo(Duration.ofSeconds(10));
    assertThat(timers.remaining(ALICE, NOW.plusSeconds(4))).isEqualTo(Duration.ofSeconds(6));
    assertThat(timers.running(ALICE, NOW.plusMillis(9_999))).isTrue();
    assertThat(timers.running(ALICE, NOW.plusSeconds(10))).isFalse();
    assertThat(timers.remaining(BOB, NOW)).isZero();
  }

  @Test
  void restartingReplacesTheEnd() {
    var timers = new Timers<UUID>();
    timers.start(ALICE, Duration.ofSeconds(10), NOW);
    timers.start(ALICE, Duration.ofSeconds(2), NOW.plusSeconds(1));

    assertThat(timers.remaining(ALICE, NOW.plusSeconds(1))).isEqualTo(Duration.ofSeconds(2));
  }

  @Test
  void stopReportsWhetherTheTimerWasRunning() {
    var timers = new Timers<UUID>();
    timers.start(ALICE, Duration.ofSeconds(5), NOW);

    assertThat(timers.stop(ALICE, NOW.plusSeconds(6))).isFalse();
    timers.start(ALICE, Duration.ofSeconds(5), NOW);
    assertThat(timers.stop(ALICE, NOW.plusSeconds(1))).isTrue();
    assertThat(timers.running(ALICE, NOW.plusSeconds(1))).isFalse();
    assertThat(timers.stop(BOB, NOW)).isFalse();
  }

  @Test
  void expireRemovesOnlyFinishedTimers() {
    var timers = new Timers<UUID>();
    timers.start(ALICE, Duration.ofSeconds(5), NOW);
    timers.start(BOB, Duration.ofSeconds(50), NOW);

    assertThat(timers.expire(NOW.plusSeconds(5))).containsExactly(ALICE);
    assertThat(timers.keys()).containsExactly(BOB);
    assertThat(timers.expire(NOW.plusSeconds(5))).isEmpty();
  }

  @Test
  void timersCannotRunBackwards() {
    assertThatThrownBy(() -> new Timers<UUID>().start(ALICE, Duration.ofSeconds(-1), NOW))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void spellsInOneCooldownGroupShareItsCooldown() {
    var cooldowns = new Timers<CooldownKey>();
    // Dawn and Dusk share the "sky" group; Leap has its own.
    cooldowns.start(new CooldownKey(ALICE, "sky"), Duration.ofMinutes(5), NOW);

    assertThat(cooldowns.running(new CooldownKey(ALICE, "sky"), NOW.plusSeconds(10))).isTrue();
    assertThat(cooldowns.running(new CooldownKey(ALICE, "leap"), NOW.plusSeconds(10))).isFalse();
    assertThat(cooldowns.running(new CooldownKey(BOB, "sky"), NOW.plusSeconds(10))).isFalse();
  }
}
