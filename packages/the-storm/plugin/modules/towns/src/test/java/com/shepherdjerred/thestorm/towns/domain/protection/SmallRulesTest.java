package com.shepherdjerred.thestorm.towns.domain.protection;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.towns.domain.Fixtures;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlags;
import java.util.Arrays;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Outsider flags, acts, verdicts and the denial throttle. */
final class SmallRulesTest {

  @Test
  void eachPublicFlagOpensItsActions() {
    assertThat(OutsiderAccess.opening(Action.BUILD)).isEqualTo(flag(ClaimFlag.PUBLIC_BUILD));
    assertThat(OutsiderAccess.opening(Action.BREAK)).isEqualTo(flag(ClaimFlag.PUBLIC_BUILD));
    assertThat(OutsiderAccess.opening(Action.PLACE_ENTITY)).isEqualTo(flag(ClaimFlag.PUBLIC_BUILD));
    assertThat(OutsiderAccess.opening(Action.INTERACT)).isEqualTo(flag(ClaimFlag.PUBLIC_SWITCHES));
    assertThat(OutsiderAccess.opening(Action.USE_REDSTONE))
        .isEqualTo(flag(ClaimFlag.PUBLIC_SWITCHES));
    assertThat(OutsiderAccess.opening(Action.DAMAGE_ENTITY))
        .isEqualTo(flag(ClaimFlag.PUBLIC_ENTITIES));
    assertThat(OutsiderAccess.opening(Action.INTERACT_ENTITY))
        .isEqualTo(flag(ClaimFlag.PUBLIC_ENTITIES));
    assertThat(OutsiderAccess.opening(Action.ATTACK_PLAYER)).isEqualTo(flag(ClaimFlag.PVP));
    assertThat(OutsiderAccess.opening(Action.TELEPORT_INTO))
        .isEqualTo(new OutsiderAccess.Opening.Never());
    assertThat(OutsiderAccess.opening(Action.SET_HOME))
        .isEqualTo(new OutsiderAccess.Opening.Never());
  }

  @Test
  void containersWithoutLocksFollowPublicBuild() {
    assertThat(OutsiderAccess.opening(Action.OPEN_CONTAINER))
        .isEqualTo(flag(ClaimFlag.PUBLIC_BUILD));
    assertThat(OutsiderAccess.opens(Action.OPEN_CONTAINER, ClaimFlags.none())).isFalse();
    assertThat(OutsiderAccess.opens(Action.OPEN_CONTAINER, ClaimFlags.of(ClaimFlag.PUBLIC_BUILD)))
        .isTrue();
    assertThat(OutsiderAccess.opens(Action.TELEPORT_INTO, ClaimFlags.of(ClaimFlag.values())))
        .isFalse();
    assertThat(OutsiderAccess.opens(Action.BUILD, ClaimFlags.of(ClaimFlag.PUBLIC_BUILD))).isTrue();
    assertThat(OutsiderAccess.opens(Action.BUILD, ClaimFlags.none())).isFalse();
  }

  private static OutsiderAccess.Opening flag(ClaimFlag flag) {
    return new OutsiderAccess.Opening.ByFlag(flag);
  }

  @Test
  void noFlagOpensAnythingToOutsidersWithoutBeingAPublicOrPvpFlag() {
    var opening =
        Arrays.stream(Action.values())
            .map(OutsiderAccess::opening)
            .flatMap(
                open ->
                    open instanceof OutsiderAccess.Opening.ByFlag(var flag)
                        ? java.util.stream.Stream.of(flag)
                        : java.util.stream.Stream.empty())
            .distinct()
            .toList();
    assertThat(opening)
        .doesNotContain(ClaimFlag.EXPLOSIONS, ClaimFlag.FIRE_SPREAD, ClaimFlag.MOB_GRIEFING);
  }

  @Test
  void anyIsNotASubject() {
    assertThatThrownBy(() -> new Act(Action.BUILD, Subject.ANY))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void aVerdictChainsToTheFirstDenial() {
    var deny = new Verdict.Deny(new Denial.NoPvp());
    assertThat(Verdict.allow().and(deny)).isEqualTo(deny);
    assertThat(deny.and(Verdict.allow())).isEqualTo(deny);
    assertThat(Verdict.allow().and(Verdict.allow()).isAllowed()).isTrue();
  }

  @Test
  void theThrottleTellsOncePerCooldownPerDenial() {
    var throttle = new DenialThrottle(2_000);
    var player = UUID.randomUUID();
    var build = new Denial.ByTown(Fixtures.TOWN_A, Action.BUILD);
    var open = new Denial.ByTown(Fixtures.TOWN_A, Action.OPEN_CONTAINER);

    assertThat(throttle.shouldTell(player, build, 0)).isTrue();
    assertThat(throttle.shouldTell(player, build, 1_999)).isFalse();
    assertThat(throttle.shouldTell(player, open, 2_000)).isTrue();
    assertThat(throttle.shouldTell(player, build, 2_001)).isTrue();
    assertThat(throttle.shouldTell(player, build, 4_000)).isFalse();
    assertThat(throttle.shouldTell(player, build, 4_001)).isTrue();
  }

  @Test
  void theThrottleKeepsPlayersApartAndForgets() {
    var throttle = new DenialThrottle(1_000);
    var alice = UUID.randomUUID();
    var bob = UUID.randomUUID();
    var denial = new Denial.NoPvp();

    assertThat(throttle.shouldTell(alice, denial, 0)).isTrue();
    assertThat(throttle.shouldTell(bob, denial, 0)).isTrue();
    throttle.forget(alice);
    assertThat(throttle.shouldTell(alice, denial, 1)).isTrue();
    assertThat(throttle.shouldTell(bob, denial, 1)).isFalse();
  }

  @Test
  void aNegativeCooldownIsRejected() {
    assertThatThrownBy(() -> new DenialThrottle(-1)).isInstanceOf(IllegalArgumentException.class);
  }
}
