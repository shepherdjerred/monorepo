package com.shepherdjerred.thestorm.essentials.domain.afk;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;

final class AfkStateTest {

  static final Instant T0 = Instant.parse("2026-09-25T12:00:00Z");
  static final Duration TIMEOUT = Duration.ofMinutes(5);

  @Test
  void aJoiningPlayerIsActive() {
    assertThat(AfkState.joined(T0)).isEqualTo(new AfkState(T0, false));
  }

  @Test
  void becomesAwayExactlyAtTheTimeout() {
    var state = AfkState.joined(T0);

    assertThat(state.idleCheck(TIMEOUT, T0.plus(TIMEOUT).minusMillis(1)).afk()).isFalse();
    assertThat(state.idleCheck(TIMEOUT, T0.plus(TIMEOUT)).afk()).isTrue();
  }

  @Test
  void idleCheckKeepsTheLastActivity() {
    var away = AfkState.joined(T0).idleCheck(TIMEOUT, T0.plus(Duration.ofHours(1)));

    assertThat(away.lastActivity()).isEqualTo(T0);
    assertThat(away.idleCheck(TIMEOUT, T0.plus(Duration.ofHours(2)))).isSameAs(away);
  }

  @Test
  void activityBringsAPlayerBack() {
    var later = T0.plus(Duration.ofHours(1));
    var back = AfkState.joined(T0).idleCheck(TIMEOUT, later).active(later);

    assertThat(back).isEqualTo(new AfkState(later, false));
  }

  @Test
  void activityResetsTheIdleClock() {
    var state = AfkState.joined(T0).active(T0.plus(Duration.ofMinutes(4)));

    assertThat(state.idleCheck(TIMEOUT, T0.plus(Duration.ofMinutes(8))).afk()).isFalse();
  }

  @Test
  void toggleFlipsAwayStatus() {
    var away = AfkState.joined(T0).toggle(T0);
    assertThat(away.afk()).isTrue();
    assertThat(away.toggle(T0).afk()).isFalse();
  }
}
