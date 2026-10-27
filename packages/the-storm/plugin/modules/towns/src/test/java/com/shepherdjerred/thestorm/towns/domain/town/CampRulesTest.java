package com.shepherdjerred.thestorm.towns.domain.town;

import static com.shepherdjerred.thestorm.towns.domain.Fixtures.FOUNDED;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.MEMBER;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.OWNER;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.towns.domain.land.ChunkPos;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Camp clocks, the house-start signal, and graduating a camp into a town. */
final class CampRulesTest {

  private static final CampPolicy POLICY = new CampPolicy(16, 8, 90, 14, 24, 5);
  private static final UUID CAMP = UUID.fromString("00000000-0000-4000-8000-0000000000c1");
  private static final ChunkPos CHUNK = new ChunkPos("world", 3, 4);

  @Test
  void anOnlineMemberRefreshesTheClock() {
    var camp = Town.camp(CAMP, FOUNDED, OWNER);

    assertThat(CampClock.decide(camp, FOUNDED.plusSeconds(1), true, POLICY))
        .isEqualTo(CampClock.Action.REFRESH);
  }

  @Test
  void theWarningWindowFiresOnce() {
    var camp = Town.camp(CAMP, FOUNDED, OWNER);
    var inside = FOUNDED.plus(POLICY.idle()).minus(POLICY.warn());

    assertThat(CampClock.decide(camp, inside, false, POLICY)).isEqualTo(CampClock.Action.WARN);
    assertThat(CampClock.decide(camp.warned(), inside, false, POLICY))
        .isEqualTo(CampClock.Action.NONE);
  }

  @Test
  void anIdleCampLapses() {
    var camp = Town.camp(CAMP, FOUNDED, OWNER);

    assertThat(CampClock.decide(camp, FOUNDED.plus(POLICY.idle()), false, POLICY))
        .isEqualTo(CampClock.Action.LAPSE);
  }

  @Test
  void aBedOrAChestAndDoorStartsAHouseImmediately() {
    assertThat(
            HouseStart.ready(
                CHUNK,
                new HouseStart.Placements(true, false, false, 0, Optional.empty()),
                FOUNDED,
                POLICY))
        .contains(CHUNK);
    assertThat(
            HouseStart.ready(
                CHUNK,
                new HouseStart.Placements(false, true, true, 0, Optional.empty()),
                FOUNDED,
                POLICY))
        .contains(CHUNK);
    assertThat(
            HouseStart.ready(
                CHUNK,
                new HouseStart.Placements(false, true, false, 0, Optional.empty()),
                FOUNDED,
                POLICY))
        .isEmpty();
  }

  @Test
  void solidBlocksCountOnlyAfterTheStay() {
    var early = FOUNDED.plus(POLICY.settleStay()).minusSeconds(1);
    var ready = FOUNDED.plus(POLICY.settleStay());

    assertThat(
            HouseStart.ready(
                CHUNK,
                new HouseStart.Placements(false, false, false, 24, Optional.of(FOUNDED)),
                early,
                POLICY))
        .isEmpty();
    assertThat(
            HouseStart.ready(
                CHUNK,
                new HouseStart.Placements(false, false, false, 24, Optional.of(FOUNDED)),
                ready,
                POLICY))
        .contains(CHUNK);
    assertThat(
            HouseStart.ready(
                CHUNK,
                new HouseStart.Placements(false, false, false, 23, Optional.of(FOUNDED)),
                ready,
                POLICY))
        .isEmpty();
  }

  @Test
  void graduatingKeepsTheMembersAndDropsTheClock() {
    var camp = Town.camp(CAMP, FOUNDED, OWNER).withMember(MEMBER, TownRole.MEMBER);
    var directory =
        new TownDirectory() {
          @Override
          public Optional<Town> townOf(UUID player) {
            return camp.roleOf(player).map(role -> camp);
          }

          @Override
          public Optional<Town> named(String name) {
            return Optional.empty();
          }
        };

    var graduated = TownRules.graduate(OWNER, "Aegis", 1, directory);

    if (!(graduated instanceof Result.Ok<Town, ?>(var town))) {
      throw new AssertionError(graduated);
    }
    assertThat(town.isCamp()).isFalse();
    assertThat(town.name()).isEqualTo("Aegis");
    assertThat(town.members()).containsEntry(MEMBER, TownRole.MEMBER);
    assertThat(town.lastActive()).isEmpty();
    assertThat(town.governorLevel()).isEqualTo(1);
  }

  @Test
  void graduatingWithoutGovernorIIsRefused() {
    var camp = Town.camp(CAMP, FOUNDED, OWNER);
    TownDirectory directory =
        new TownDirectory() {
          @Override
          public Optional<Town> townOf(UUID player) {
            return player.equals(OWNER) ? Optional.of(camp) : Optional.empty();
          }

          @Override
          public Optional<Town> named(String name) {
            return Optional.empty();
          }
        };

    assertThat(TownRules.graduate(OWNER, "Aegis", 0, directory))
        .isEqualTo(Result.err(java.util.List.of(new TownProblem.NeedsGovernor())));
  }
}
