package com.shepherdjerred.thestorm.towns.domain.town;

import static com.shepherdjerred.thestorm.towns.domain.Fixtures.MEMBER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.NOMAD;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OWNER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.TOWN_A;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.TOWN_B;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.TRUSTED_OUTSIDER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.claim;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.towns.domain.Fixtures;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import com.shepherdjerred.thestorm.towns.domain.protection.Act;
import com.shepherdjerred.thestorm.towns.domain.protection.Action;
import com.shepherdjerred.thestorm.towns.domain.protection.Subject;
import com.shepherdjerred.thestorm.towns.domain.protection.TrustLevel;
import java.util.EnumSet;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

/** Claim trust: build, containers and switches on one chunk for one outsider, nothing more. */
final class ClaimTrustTest {

  private static final EnumSet<Action> GRANTED =
      EnumSet.of(
          Action.BUILD,
          Action.BREAK,
          Action.PLACE_ENTITY,
          Action.OPEN_CONTAINER,
          Action.INTERACT,
          Action.USE_REDSTONE);

  private final Town aegis = Fixtures.townA();

  @ParameterizedTest
  @EnumSource(Action.class)
  void aTrustedOutsiderGetsOnlyBuildContainersAndSwitches(Action action) {
    var trusted = claim(TOWN_A, 0, 0).withTrust(TRUSTED_OUTSIDER, true);
    var act = new Act(action, Subject.BLOCK);

    assertThat(ClaimTrust.of(aegis, trusted, TRUSTED_OUTSIDER, act))
        .isEqualTo(GRANTED.contains(action) ? TrustLevel.TRUSTED : TrustLevel.OUTSIDER);
    assertThat(ClaimTrust.coveredByClaimTrust(action)).isEqualTo(GRANTED.contains(action));
    assertThat(ClaimTrust.of(aegis, trusted, NOMAD, act)).isEqualTo(TrustLevel.OUTSIDER);
  }

  @Test
  void trustStaysOnItsChunk() {
    var trustedHere = claim(TOWN_A, 0, 0).withTrust(TRUSTED_OUTSIDER, true);
    var elsewhere = claim(TOWN_A, 1, 0);
    var build = new Act(Action.BUILD, Subject.BLOCK);

    assertThat(ClaimTrust.of(aegis, trustedHere, TRUSTED_OUTSIDER, build))
        .isEqualTo(TrustLevel.TRUSTED);
    assertThat(ClaimTrust.of(aegis, elsewhere, TRUSTED_OUTSIDER, build))
        .isEqualTo(TrustLevel.OUTSIDER);
  }

  @Test
  void membersKeepTheirRankWhateverTheTrustList() {
    var claim = claim(TOWN_A, 0, 0).withTrust(MEMBER, true);
    var hurt = new Act(Action.DAMAGE_ENTITY, Subject.ANIMAL);

    assertThat(ClaimTrust.of(aegis, claim, OWNER, hurt)).isEqualTo(TrustLevel.OWNER);
    assertThat(ClaimTrust.of(aegis, claim, MEMBER, hurt)).isEqualTo(TrustLevel.TRUSTED);
  }

  @Test
  void theClaimMustBeTheTowns() {
    assertThatThrownBy(
            () ->
                ClaimTrust.of(
                    aegis, claim(TOWN_B, 0, 0), NOMAD, new Act(Action.BUILD, Subject.BLOCK)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void untrustingRemovesOnlyThatPlayer() {
    var claim = claim(TOWN_A, 0, 0).withTrust(TRUSTED_OUTSIDER, true).withTrust(NOMAD, true);

    assertThat(claim.withTrust(NOMAD, false).trusted()).containsExactly(TRUSTED_OUTSIDER);
    assertThat(claim.withFlag(ClaimFlag.PVP, true).trusted())
        .containsExactlyInAnyOrder(TRUSTED_OUTSIDER, NOMAD);
  }
}
