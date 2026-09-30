package com.shepherdjerred.thestorm.towns.domain.protection;

import static com.shepherdjerred.thestorm.towns.domain.Fixtures.NOMAD;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OTHER_TOWN_OWNER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.TOWN_A;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.towns.domain.Fixtures;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import com.shepherdjerred.thestorm.towns.domain.land.Land;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * Every combination of the attacker's own PvP switch, the victim's own switch, and PvP on the
 * attacker's and victim's land: a fight happens only when all four allow it. The reason given names
 * the first thing in the way: the attacker's switch, then the land, then the victim's switch.
 */
final class PvpMatrixTest {

  private static final UUID ATTACKER = NOMAD;
  private static final UUID VICTIM = OTHER_TOWN_OWNER;

  private static final Land PVP_ON = Fixtures.land(TOWN_A, ClaimFlag.PVP);
  private static final Land PVP_OFF = Fixtures.land(TOWN_A);

  static Stream<Arguments> cases() {
    var cases = new ArrayList<Arguments>();
    for (var attackerOn : List.of(true, false)) {
      for (var victimOn : List.of(true, false)) {
        for (var attackerLandOn : List.of(true, false)) {
          for (var victimLandOn : List.of(true, false)) {
            cases.add(Arguments.of(attackerOn, victimOn, attackerLandOn, victimLandOn));
          }
        }
      }
    }
    return cases.stream();
  }

  @ParameterizedTest(name = "attacker {0}, victim {1}, attacker land {2}, victim land {3}")
  @MethodSource("cases")
  void aFightNeedsEveryoneAndEverywhereOn(
      boolean attackerOn, boolean victimOn, boolean attackerLandOn, boolean victimLandOn) {
    var engine = engine(attackerOn, victimOn);
    var attackerLand = attackerLandOn ? PVP_ON : PVP_OFF;
    var victimLand = victimLandOn ? PVP_ON : PVP_OFF;

    var verdict = engine.decidePvp(Actor.player(ATTACKER), VICTIM, attackerLand, victimLand);
    var viaHarm =
        engine.decideHarm(
            Actor.player(ATTACKER), attackerLand, new Victim.OtherPlayer(VICTIM), victimLand);

    assertThat(viaHarm).isEqualTo(verdict);
    if (!attackerOn) {
      assertThat(verdict).isEqualTo(new Verdict.Deny(new Denial.YourPvpIsOff()));
    } else if (!attackerLandOn || !victimLandOn) {
      assertThat(verdict).isEqualTo(new Verdict.Deny(new Denial.NoPvp()));
    } else if (!victimOn) {
      assertThat(verdict).isEqualTo(new Verdict.Deny(new Denial.TheirPvpIsOff()));
    } else {
      assertThat(verdict.isAllowed()).isTrue();
    }
  }

  @Test
  void aPlayerWithPvpOffFightsNobodyEvenInTheWilderness() {
    var wild = new Land.Wilderness();

    assertThat(engine(false, true).decidePvp(Actor.player(ATTACKER), VICTIM, wild, wild))
        .isEqualTo(new Verdict.Deny(new Denial.YourPvpIsOff()));
    assertThat(engine(true, false).decidePvp(Actor.player(ATTACKER), VICTIM, wild, wild))
        .isEqualTo(new Verdict.Deny(new Denial.TheirPvpIsOff()));
    assertThat(engine(true, true).decidePvp(Actor.player(ATTACKER), VICTIM, wild, wild).isAllowed())
        .isTrue();
  }

  @Test
  void bypassDoesNotOverrideAnyonesSwitch() {
    var staff = new Actor(ATTACKER, true);
    var wild = new Land.Wilderness();

    assertThat(engine(true, false).decidePvp(staff, VICTIM, wild, wild).isAllowed()).isFalse();
    assertThat(engine(false, true).decidePvp(staff, VICTIM, wild, wild).isAllowed()).isFalse();
  }

  @Test
  void theAttackersHalfIgnoresTheVictim() {
    var wild = new Land.Wilderness();

    assertThat(engine(true, false).decideAttack(Actor.player(ATTACKER), wild, wild).isAllowed())
        .isTrue();
    assertThat(engine(false, true).decideAttack(Actor.player(ATTACKER), wild, wild))
        .isEqualTo(new Verdict.Deny(new Denial.YourPvpIsOff()));
  }

  @Test
  void switchesNeverTouchAnimalsOrPets() {
    var engine = engine(false, false);
    var wild = new Land.Wilderness();

    assertThat(
            engine
                .decideHarm(
                    Actor.player(ATTACKER), wild, new Victim.Protected(Subject.ANIMAL), wild)
                .isAllowed())
        .isTrue();
    assertThat(engine.decideHarm(Actor.player(ATTACKER), wild, new Victim.Self(), wild).isAllowed())
        .isTrue();
  }

  private static ProtectionEngine engine(boolean attackerOn, boolean victimOn) {
    var off = new HashSet<UUID>();
    if (!attackerOn) {
      off.add(ATTACKER);
    }
    if (!victimOn) {
      off.add(VICTIM);
    }
    var switchedOff = Set.copyOf(off);
    return new ProtectionEngine(Fixtures.trust(), player -> !switchedOff.contains(player));
  }
}
