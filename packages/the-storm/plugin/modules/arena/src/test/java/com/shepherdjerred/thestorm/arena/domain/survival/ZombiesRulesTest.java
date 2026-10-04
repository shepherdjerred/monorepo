package com.shepherdjerred.thestorm.arena.domain.survival;

import static com.shepherdjerred.thestorm.arena.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.arena.testing.Samples.BOB;
import static com.shepherdjerred.thestorm.arena.testing.Samples.T0;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Set;
import org.junit.jupiter.api.Test;

final class ZombiesRulesTest {
  private static final Set<String> PARTS = Set.of("controls", "engine", "wings");

  @Test
  void planeCargoIsExclusiveAndReturnsWhenACarrierLeaves() {
    var quest = new PlaneQuest(PARTS);
    assertThat(quest.take(ALICE, "engine")).isTrue();
    assertThat(quest.take(ALICE, "wings")).isFalse();
    assertThat(quest.take(BOB, "engine")).isFalse();
    quest.leave(ALICE);
    assertThat(quest.take(BOB, "engine")).isTrue();
    assertThat(quest.install(BOB)).isTrue();
    assertThat(quest.take(ALICE, "engine")).isFalse();
  }

  @Test
  void repeatFlightsRequireAllThreeFuelPickupsAndAClearedRound() {
    var quest = new PlaneQuest(PARTS);
    for (var part : PARTS) {
      assertThat(quest.take(ALICE, part)).isTrue();
      assertThat(quest.install(ALICE)).isTrue();
    }
    assertThat(quest.depart(7)).isFalse();
    quest.power();
    assertThat(quest.depart(7)).isTrue();
    assertThat(quest.depart(8)).isFalse();
    for (var part : PARTS) {
      assertThat(quest.take(BOB, part)).isTrue();
      assertThat(quest.install(BOB)).isTrue();
    }
    assertThat(quest.depart(7)).isFalse();
    assertThat(quest.depart(8)).isTrue();
    assertThat(quest.fuel()).isZero();
  }

  @Test
  void onlyDistinctClicksOnTheSameSignWithinThreeSecondsConfirm() {
    var clicks = new PurchaseConfirmation();
    assertThat(clicks.confirm(ALICE, "quarry", T0)).isFalse();
    assertThat(clicks.confirm(ALICE, "quarry", T0.plusMillis(50))).isFalse();
    assertThat(clicks.confirm(BOB, "quarry", T0.plusMillis(300))).isFalse();
    assertThat(clicks.confirm(ALICE, "foundry", T0.plusMillis(300))).isFalse();
    assertThat(clicks.confirm(ALICE, "foundry", T0.plusMillis(600))).isTrue();
    assertThat(clicks.confirm(ALICE, "quarry", T0.plusSeconds(4))).isFalse();
    assertThat(clicks.confirm(ALICE, "quarry", T0.plusSeconds(8))).isFalse();
  }

  @Test
  void debugLobbiesAreSharedAndCannotFastForwardAnActiveOrNormalLobby() {
    var game = new SurvivalGame();
    assertThat(game.debugStart(15)).isTrue();
    assertThat(game.join(ALICE, "Alice", false)).isEmpty();
    game.admitted(ALICE, false);
    assertThat(game.debugStart(15)).isTrue();
    assertThat(game.debugStart(16)).isFalse();
    assertThat(game.join(BOB, "Bob", false)).isEmpty();
    game.admitted(BOB, false);
    game.forceStart(T0);
    game.advance(T0);
    assertThat(game.round()).isEqualTo(15);
    assertThat(game.debugStart(20)).isFalse();
    game.reset();
    game.join(ALICE, "Alice", false);
    assertThat(game.debugStart(5)).isFalse();
  }

  @Test
  void openingPressureAndBossHealthMatchPartyBudgets() {
    var counts = new int[] {6, 8, 10, 12, 4, 16, 18};
    var caps = new int[] {3, 4, 5, 6, 3, 7, 8};
    for (var round = 1; round <= 7; round++) {
      var solo = EncounterDirector.plan(round, 1, Set.of());
      assertThat(solo.count()).isEqualTo(counts[round - 1]);
      assertThat(solo.concurrentLimit()).isEqualTo(caps[round - 1]);
      assertThat(solo.specialBudget()).isLessThanOrEqualTo(1);
      var team = EncounterDirector.plan(round, 4, Set.of());
      assertThat(team.count()).isEqualTo(solo.count() + 9);
      assertThat(team.concurrentLimit()).isEqualTo(solo.concurrentLimit() + 6);
      assertThat(team.damage()).isEqualTo(solo.damage());
    }
    assertThat(EncounterDirector.bossHealth(5, 1)).isEqualTo(200);
    assertThat(EncounterDirector.bossHealth(5, 2)).isEqualTo(330);
    assertThat(EncounterDirector.bossHealth(5, 3)).isEqualTo(460);
    assertThat(EncounterDirector.bossHealth(5, 4))
        .isCloseTo(590, org.assertj.core.data.Offset.offset(.000001));
  }

  @Test
  void debugPresetsHaveFixedProgressionAndRejectInvalidRounds() {
    assertThat(DebugPreset.at(3).iron()).isFalse();
    assertThat(DebugPreset.at(4).iron()).isTrue();
    assertThat(DebugPreset.at(8).weaponTier()).isEqualTo(1);
    assertThat(DebugPreset.at(15).weaponTier()).isEqualTo(2);
    assertThat(DebugPreset.at(25).weaponTier()).isEqualTo(3);
    assertThatThrownBy(() -> DebugPreset.at(1001)).isInstanceOf(IllegalArgumentException.class);
  }
}
