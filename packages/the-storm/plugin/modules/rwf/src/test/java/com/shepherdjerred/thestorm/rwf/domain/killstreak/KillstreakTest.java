package com.shepherdjerred.thestorm.rwf.domain.killstreak;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

/** Red Warfare's killstreak thresholds and delivery numbers. */
final class KillstreakTest {

  @Test
  void theCompassComesOnceAndTheRestAtEveryMultiple() {
    assertThat(Killstreak.COMPASS.earnedAt(2)).isTrue();
    assertThat(Killstreak.COMPASS.earnedAt(4)).isFalse();
    assertThat(Killstreak.SUPPLY_CRATE.earnedAt(4)).isTrue();
    assertThat(Killstreak.WOLVES.earnedAt(8)).isTrue();
    assertThat(Killstreak.IRON_GOLEM.earnedAt(8)).isTrue();
    assertThat(Killstreak.IRON_GOLEM.earnedAt(12)).isFalse();
    assertThat(Killstreak.NAPALM.earnedAt(11)).isTrue();
    assertThat(Killstreak.NAPALM.earnedAt(22)).isTrue();
    assertThat(Killstreak.WOLVES.earnedAt(0)).isFalse();
  }

  @Test
  void eachStepClimbedEarnsItsRewardsInRedWarfaresOrder() {
    assertThat(Killstreak.earned(1, 2))
        .containsExactly(new Killstreak.Earned(Killstreak.COMPASS, 2));
    assertThat(Killstreak.earned(3, 4))
        .containsExactly(
            new Killstreak.Earned(Killstreak.SUPPLY_CRATE, 4),
            new Killstreak.Earned(Killstreak.WOLVES, 4));
    assertThat(Killstreak.earned(7, 8))
        .containsExactly(
            new Killstreak.Earned(Killstreak.SUPPLY_CRATE, 8),
            new Killstreak.Earned(Killstreak.WOLVES, 8),
            new Killstreak.Earned(Killstreak.IRON_GOLEM, 8));
    assertThat(Killstreak.earned(2, 2)).isEmpty();
    assertThat(Killstreak.earned(10, 11))
        .containsExactly(new Killstreak.Earned(Killstreak.NAPALM, 11));
  }

  @Test
  void itemsNameTheirRewards() {
    assertThat(Killstreak.byItem("TNT")).contains(Killstreak.NAPALM);
    assertThat(Killstreak.byItem("REDSTONE")).contains(Killstreak.SUPPLY_CRATE);
    assertThat(Killstreak.byItem("IRON_SWORD")).isEmpty();
    assertThat(Killstreak.COMPASS.dropped()).isFalse();
    assertThat(Killstreak.WOLVES.dropped()).isTrue();
  }

  @Test
  void aRewardFallsFromAHundredAboveItsBlockButFiftyAboveTheHighest() {
    assertThat(Delivery.dropHeight(64, 64)).isEqualTo(164);
    assertThat(Delivery.dropHeight(100, 20)).isEqualTo(150);
    assertThat(Delivery.dropHeight(64, 70)).isEqualTo(170);
  }

  @Test
  void aCrateIsTheOwnersAtOnceTheTeamsAfterThirtySecondsAndAnyonesAfterAMinute() {
    assertThat(Delivery.mayLoot(true, true, Duration.ZERO)).isTrue();
    assertThat(Delivery.mayLoot(false, true, Duration.ofSeconds(29))).isFalse();
    assertThat(Delivery.mayLoot(false, true, Duration.ofSeconds(30))).isTrue();
    assertThat(Delivery.mayLoot(false, false, Duration.ofSeconds(59))).isFalse();
    assertThat(Delivery.mayLoot(false, false, Duration.ofSeconds(60))).isTrue();
    assertThat(Delivery.crowded(0, 0, 1, 0)).isTrue();
    assertThat(Delivery.crowded(0, 0, 1, 1)).isFalse();
  }

  @Test
  void aCrateHoldsSteakPearlsUntilTheEndgameAndSometimesAChestplate() {
    var random = new SplittableRandom(3);
    for (var i = 0; i < 50; i++) {
      var loot = Delivery.loot(random, false, false);
      assertThat(loot.steak()).isBetween(1, 3);
      assertThat(loot.pearls()).isBetween(1, 3);
    }
    var late = Delivery.loot(random, true, true);
    assertThat(late.pearls()).isZero();
    assertThat(late.chestplate()).isFalse();
  }

  @Test
  void napalmBurnsLongerTheCloserYouStand() {
    assertThat(Delivery.fireTicks(0)).isEqualTo(100);
    assertThat(Delivery.fireTicks(9.5)).isEqualTo(50);
    assertThat(Delivery.fireTicks(20)).isZero();
    assertThat(Delivery.golemBlow(new SplittableRandom(1))).isBetween(13.0, 14.0);
    var stray = 0.0;
    var random = new SplittableRandom(9);
    for (var i = 0; i < 200; i++) {
      stray = Delivery.stray(stray, random);
      assertThat(stray).isBetween(-Delivery.COMPASS_STRAY, Delivery.COMPASS_STRAY);
    }
  }
}
