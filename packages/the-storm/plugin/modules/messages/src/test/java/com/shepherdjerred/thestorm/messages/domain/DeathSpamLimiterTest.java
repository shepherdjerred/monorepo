package com.shepherdjerred.thestorm.messages.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class DeathSpamLimiterTest {

  private static final Instant START = Instant.parse("2017-03-21T12:00:00Z");
  private static final Duration WINDOW = Duration.ofMinutes(5);
  private static final UUID STEVE = UUID.fromString("00000000-0000-0000-0000-000000000001");
  private static final UUID ALEX = UUID.fromString("00000000-0000-0000-0000-000000000002");

  private DeathSpamLimiter limiter = DeathSpamLimiter.of(3, WINDOW);

  @Test
  void announcesUpToTheLimitThenHides() {
    assertThat(die(STEVE, 0)).isTrue();
    assertThat(die(STEVE, 10)).isTrue();
    assertThat(die(STEVE, 20)).isTrue();
    assertThat(die(STEVE, 30)).isFalse();
    assertThat(die(STEVE, 40)).isFalse();
  }

  @Test
  void countsEachPlayerSeparately() {
    die(STEVE, 0);
    die(STEVE, 1);
    die(STEVE, 2);

    assertThat(die(STEVE, 3)).isFalse();
    assertThat(die(ALEX, 4)).isTrue();
  }

  @Test
  void aDeathExactlyOneWindowAgoHasExpired() {
    die(STEVE, 0);
    die(STEVE, 100);
    die(STEVE, 200);

    // At 300s the death at 0s is exactly one window old and no longer counts.
    assertThat(die(STEVE, 300)).isTrue();
  }

  @Test
  void aDeathJustInsideTheWindowStillCounts() {
    die(STEVE, 0);
    die(STEVE, 100);
    die(STEVE, 200);

    assertThat(dieAt(STEVE, START.plus(WINDOW).minusMillis(1))).isFalse();
  }

  @Test
  void hiddenDeathsKeepThePlayerHiddenUntilTheyGoQuiet() {
    for (var second = 0; second < 3; second++) {
      die(STEVE, second);
    }
    // Keep dying every two minutes: each death still has three others inside the window.
    assertThat(die(STEVE, 120)).isFalse();
    assertThat(die(STEVE, 240)).isFalse();
    assertThat(die(STEVE, 360)).isFalse();
    assertThat(die(STEVE, 480)).isFalse();
    // A full quiet window later, the slate is clean.
    assertThat(die(STEVE, 480 + 300)).isTrue();
  }

  @Test
  void steadyDeathsBelowTheLimitAreAlwaysAnnounced() {
    // One death every two minutes never puts more than three inside a five-minute window.
    for (var second = 0; second < 3600; second += 120) {
      assertThat(die(STEVE, second)).as("death at %ds", second).isTrue();
    }
  }

  @Test
  void forgetsPlayersWhoseDeathsHaveExpired() {
    die(STEVE, 0);
    die(ALEX, 400);

    assertThat(limiter.players()).containsOnlyKeys(ALEX);
  }

  @Test
  void aLimitOfOneAnnouncesOnlyTheFirstDeath() {
    limiter = DeathSpamLimiter.of(1, WINDOW);

    assertThat(die(STEVE, 0)).isTrue();
    assertThat(die(STEVE, 1)).isFalse();
    assertThat(die(STEVE, 302)).isTrue();
  }

  @Test
  void isImmutable() {
    var before = limiter;
    var verdict = limiter.record(STEVE, START);

    assertThat(before.players()).isEmpty();
    assertThat(verdict.next().players())
        .containsEntry(STEVE, new DeathSpamLimiter.Streak(List.of(START), false));
    assertThatThrownBy(
            () -> verdict.next().players().put(ALEX, new DeathSpamLimiter.Streak(List.of(), false)))
        .isInstanceOf(UnsupportedOperationException.class);
  }

  @Test
  void copiesTheStateItIsGiven() {
    var deaths = new ArrayList<>(List.of(START));
    var copy =
        new DeathSpamLimiter(3, WINDOW, Map.of(STEVE, new DeathSpamLimiter.Streak(deaths, false)));
    deaths.add(START.plusSeconds(1));

    assertThat(copy.players())
        .containsEntry(STEVE, new DeathSpamLimiter.Streak(List.of(START), false));
  }

  @Test
  void rejectsBadLimits() {
    assertThatThrownBy(() -> DeathSpamLimiter.of(0, WINDOW))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> DeathSpamLimiter.of(3, Duration.ZERO))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> DeathSpamLimiter.of(3, Duration.ofSeconds(-1)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  private boolean die(UUID player, long secondsAfterStart) {
    return dieAt(player, START.plusSeconds(secondsAfterStart));
  }

  private boolean dieAt(UUID player, Instant at) {
    var verdict = limiter.record(player, at);
    limiter = verdict.next();
    return verdict.announce();
  }
}
