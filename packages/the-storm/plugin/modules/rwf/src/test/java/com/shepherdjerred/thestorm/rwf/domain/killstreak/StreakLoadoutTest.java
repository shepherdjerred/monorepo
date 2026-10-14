package com.shepherdjerred.thestorm.rwf.domain.killstreak;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.Test;

final class StreakLoadoutTest {
  @Test
  void defaultRewardsNeverGiveBothFourKillChoicesOrRepeatAtMultiples() {
    assertThat(StreakLoadout.DEFAULT.earned(0, 100))
        .containsExactly(
            new Killstreak.Earned(Killstreak.COMPASS, 2),
            new Killstreak.Earned(Killstreak.SUPPLY_CRATE, 4),
            new Killstreak.Earned(Killstreak.IRON_GOLEM, 8));
    assertThat(StreakLoadout.DEFAULT.earned(8, 100)).isEmpty();
  }

  @Test
  void threeDistinctThresholdsAreRequiredEvenWhenRewardIdsDiffer() {
    assertThatThrownBy(
            () ->
                new StreakLoadout(
                    List.of(Killstreak.SUPPLY_CRATE, Killstreak.WOLVES, Killstreak.NAPALM)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(
            () ->
                new StreakLoadout(
                    List.of(Killstreak.COMPASS, Killstreak.COMPASS, Killstreak.NAPALM)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new StreakLoadout(List.of(Killstreak.COMPASS, Killstreak.WOLVES)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void wolvesReplaceTheCrateAndAlternateThresholdCombinationsAreAllowed() {
    var wolves =
        new StreakLoadout(List.of(Killstreak.NAPALM, Killstreak.WOLVES, Killstreak.COMPASS));
    assertThat(wolves.rewards())
        .containsExactly(Killstreak.COMPASS, Killstreak.WOLVES, Killstreak.NAPALM);
    assertThat(wolves.earned(3, 4)).containsExactly(new Killstreak.Earned(Killstreak.WOLVES, 4));
    assertThat(wolves.earned(7, 8)).isEmpty();
    assertThat(wolves.earned(10, 11)).containsExactly(new Killstreak.Earned(Killstreak.NAPALM, 11));
    assertThatThrownBy(() -> wolves.rewards().add(Killstreak.SUPPLY_CRATE))
        .isInstanceOf(UnsupportedOperationException.class);
  }
}
