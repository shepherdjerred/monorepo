package com.shepherdjerred.thestorm.towns.domain.protection;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.towns.domain.Fixtures;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import java.util.Arrays;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Outsider flags, acts, verdicts and the denial throttle. */
final class SmallRulesTest {

  @Test
  void eachPublicFlagOpensItsActions() {
    assertThat(OutsiderAccess.flagFor(Action.BUILD)).contains(ClaimFlag.PUBLIC_BUILD);
    assertThat(OutsiderAccess.flagFor(Action.BREAK)).contains(ClaimFlag.PUBLIC_BUILD);
    assertThat(OutsiderAccess.flagFor(Action.PLACE_ENTITY)).contains(ClaimFlag.PUBLIC_BUILD);
    assertThat(OutsiderAccess.flagFor(Action.OPEN_CONTAINER)).contains(ClaimFlag.PUBLIC_CONTAINERS);
    assertThat(OutsiderAccess.flagFor(Action.INTERACT)).contains(ClaimFlag.PUBLIC_SWITCHES);
    assertThat(OutsiderAccess.flagFor(Action.USE_REDSTONE)).contains(ClaimFlag.PUBLIC_SWITCHES);
    assertThat(OutsiderAccess.flagFor(Action.DAMAGE_ENTITY)).contains(ClaimFlag.PUBLIC_ENTITIES);
    assertThat(OutsiderAccess.flagFor(Action.INTERACT_ENTITY)).contains(ClaimFlag.PUBLIC_ENTITIES);
    assertThat(OutsiderAccess.flagFor(Action.ATTACK_PLAYER)).contains(ClaimFlag.PVP);
    assertThat(OutsiderAccess.flagFor(Action.TELEPORT_INTO)).isEmpty();
    assertThat(OutsiderAccess.flagFor(Action.SET_HOME)).isEmpty();
  }

  @Test
  void noFlagOpensAnythingToOutsidersWithoutBeingAPublicOrPvpFlag() {
    var opening =
        Arrays.stream(Action.values())
            .flatMap(action -> OutsiderAccess.flagFor(action).stream())
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
