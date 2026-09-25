package com.shepherdjerred.thestorm.arena.domain.boss;

import static com.shepherdjerred.thestorm.arena.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.arena.testing.Samples.BOB;
import static com.shepherdjerred.thestorm.arena.testing.Samples.CAROL;
import static com.shepherdjerred.thestorm.arena.testing.Samples.DAVE;
import static com.shepherdjerred.thestorm.arena.testing.Samples.T0;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.arena.domain.geometry.Point;
import com.shepherdjerred.thestorm.arena.domain.wave.AbilitySpec;
import com.shepherdjerred.thestorm.arena.domain.wave.AbilityType;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.random.RandomGenerator;
import org.junit.jupiter.api.Test;

final class BossRulesTest {

  private static AbilitySpec every(AbilityType type, int seconds) {
    return switch (type) {
      case HEART ->
          new AbilitySpec(type, Duration.ofSeconds(seconds), 0, 0.25, 4, Optional.empty());
      case SUMMON_ADDS ->
          new AbilitySpec(type, Duration.ofSeconds(seconds), 0, 0, 1, Optional.of("z"));
      case CHAIN_LIGHTNING ->
          new AbilitySpec(type, Duration.ofSeconds(seconds), 5, 2, 2, Optional.empty());
      default -> new AbilitySpec(type, Duration.ofSeconds(seconds), 5, 2, 0, Optional.empty());
    };
  }

  @Test
  void abilitiesFireOneCooldownAfterTheBossSpawns() {
    var slam = every(AbilityType.KNOCKBACK_SLAM, 10);
    var aura = every(AbilityType.LIGHTNING_AURA, 15);
    var clock = AbilityClock.start(List.of(slam, aura), T0);

    var early = clock.fire(T0.plusSeconds(9));
    assertThat(early.due()).isEmpty();

    var first = early.clock().fire(T0.plusSeconds(10));
    assertThat(first.due()).containsExactly(slam);

    var both = first.clock().fire(T0.plusSeconds(20));
    assertThat(both.due()).containsExactly(slam, aura);

    assertThat(both.clock().fire(T0.plusSeconds(29)).due()).isEmpty();
    assertThat(both.clock().fire(T0.plusSeconds(30)).due()).containsExactly(slam);
  }

  @Test
  void aLateCheckFiresOnceRatherThanCatchingUp() {
    var slam = every(AbilityType.KNOCKBACK_SLAM, 10);
    var clock = AbilityClock.start(List.of(slam), T0);

    var late = clock.fire(T0.plusSeconds(55));

    assertThat(late.due()).containsExactly(slam);
    assertThat(late.clock().nextAt()).containsExactly(T0.plusSeconds(65));
  }

  @Test
  void aClockNeedsATimePerAbility() {
    assertThatThrownBy(() -> new AbilityClock(List.of(every(AbilityType.DISORIENT, 5)), List.of()))
        .isInstanceOf(IllegalArgumentException.class);
  }

  private static final Map<java.util.UUID, Point> FIGHTERS =
      Map.of(
          ALICE, new Point(3, 0, 0),
          BOB, new Point(6, 0, 0),
          CAROL, new Point(9, 0, 0),
          DAVE, new Point(-20, 0, 0));

  @Test
  void areaAbilitiesHitEveryoneInRangeNearestFirst() {
    assertThat(Targets.within(new Point(0, 0, 0), FIGHTERS, 6.5)).containsExactly(ALICE, BOB);
    assertThat(Targets.within(new Point(0, 0, 0), FIGHTERS, 1)).isEmpty();
    assertThat(Targets.nearest(new Point(0, 0, 0), FIGHTERS, 100)).contains(ALICE);
  }

  @Test
  void chainLightningJumpsFromEachVictimToTheNext() {
    var chain = Targets.chain(new Point(0, 0, 0), FIGHTERS, 4, 5);

    assertThat(chain).containsExactly(ALICE, BOB, CAROL);
  }

  @Test
  void chainLightningStopsAfterItsJumps() {
    assertThat(Targets.chain(new Point(0, 0, 0), FIGHTERS, 4, 1)).containsExactly(ALICE, BOB);
    assertThat(Targets.chain(new Point(0, 0, 0), FIGHTERS, 4, 0)).containsExactly(ALICE);
  }

  @Test
  void chainLightningNeedsSomeoneInRangeToStart() {
    assertThat(Targets.chain(new Point(0, 0, 0), FIGHTERS, 2, 5)).isEmpty();
  }

  @Test
  void tiesGoToTheLowerId() {
    var tied = Map.of(BOB, new Point(1, 0, 0), ALICE, new Point(-1, 0, 0));

    assertThat(Targets.within(new Point(0, 0, 0), tied, 5)).containsExactly(ALICE, BOB);
  }

  @Test
  void aSlamPushesAwayFromTheBoss() {
    var push = Push.away(new Point(0, 64, 0), new Point(3, 64, 4), 2);

    assertThat(push.x()).isCloseTo(1.2, within(1e-9));
    assertThat(push.z()).isCloseTo(1.6, within(1e-9));
    assertThat(push.y()).isCloseTo(0.75, within(1e-9));
  }

  @Test
  void aSlamOnTopOfTheBossOnlyLifts() {
    var push = Push.away(new Point(0, 64, 0), new Point(0, 66, 0), 1);

    assertThat(push).isEqualTo(new Push(0, 0.55, 0));
  }

  @Test
  void theLiftIsCapped() {
    assertThat(Push.away(new Point(0, 0, 0), new Point(1, 0, 0), 10).y()).isEqualTo(Push.MAX_LIFT);
    assertThatThrownBy(() -> Push.away(new Point(0, 0, 0), new Point(1, 0, 0), -1))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void theHeartBreaksAfterItsHits() {
    var heart = HeartState.of(every(AbilityType.HEART, 25));

    var first = heart.hit();
    assertThat(first).isInstanceOf(HeartState.Hit.Cracked.class);
    assertThat(((HeartState.Hit.Cracked) first).remaining()).isEqualTo(3);
    var second = first.heart().hit().heart().hit();
    assertThat(second).isInstanceOf(HeartState.Hit.Cracked.class);

    var broken = second.heart().hit();
    assertThat(broken).isEqualTo(new HeartState.Hit.Broken(0.25, new HeartState(4, 0, 0.25)));
  }

  @Test
  void aOneHitHeartBreaksAtOnce() {
    assertThat(new HeartState(1, 0, 0.5).hit()).isInstanceOf(HeartState.Hit.Broken.class);
  }

  @Test
  void onlyAHeartAbilityMakesAHeart() {
    assertThatThrownBy(() -> HeartState.of(every(AbilityType.DISORIENT, 5)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new HeartState(2, 2, 0.5))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new HeartState(2, 0, 0)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void theHeartAlwaysMovesToAnotherSpawn() {
    var random = RandomGenerator.of("L64X128MixRandom");
    for (var i = 0; i < 200; i++) {
      var current = i % 4;
      var next = HeartState.relocate(current, 4, random);
      assertThat(next).isBetween(0, 3).isNotEqualTo(current);
    }
    assertThat(HeartState.relocate(0, 1, random)).isZero();
    assertThatThrownBy(() -> HeartState.relocate(4, 4, random))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
