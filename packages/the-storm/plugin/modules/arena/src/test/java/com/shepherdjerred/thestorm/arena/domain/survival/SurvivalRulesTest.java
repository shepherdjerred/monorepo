package com.shepherdjerred.thestorm.arena.domain.survival;

import static com.shepherdjerred.thestorm.arena.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.arena.testing.Samples.BOB;
import static com.shepherdjerred.thestorm.arena.testing.Samples.T0;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.arena.domain.game.GameError;
import com.shepherdjerred.thestorm.arena.domain.geometry.Point;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class SurvivalRulesTest {
  private static SurvivalGame started(boolean coop) {
    var game = new SurvivalGame();
    game.join(ALICE, "Alice", false);
    game.admitted(ALICE, false);
    if (coop) {
      game.join(BOB, "Bob", false);
      game.admitted(BOB, false);
    }
    game.forceStart(T0);
    game.advance(T0);
    return game;
  }

  @Test
  void soloHasExactlyOneSelfRevivePerRun() {
    var game = started(false);
    assertThat(game.down(ALICE, T0)).isTrue();
    assertThat(game.wiped()).isFalse();
    assertThat(game.down(ALICE, T0.plusSeconds(1))).isFalse();
    assertThat(game.wiped()).isTrue();
  }

  @Test
  void joiningOrUnreadyingCancelsTheCountdown() {
    var game = new SurvivalGame();
    game.join(ALICE, "Alice", false);
    game.admitted(ALICE, false);
    game.ready(ALICE, T0);
    assertThat(game.phase()).isEqualTo(SurvivalGame.Phase.COUNTDOWN);
    game.ready(ALICE, T0.plusSeconds(1));
    assertThat(game.player(ALICE).orElseThrow().ready()).isFalse();
    assertThat(game.advance(T0.plusSeconds(11))).isFalse();
    game.ready(ALICE, T0.plusSeconds(12));
    game.join(BOB, "Bob", false);
    assertThat(game.phase()).isEqualTo(SurvivalGame.Phase.LOBBY);
    assertThat(game.advance(T0.plusSeconds(25))).isFalse();
    game.admitted(BOB, false);
    game.ready(BOB, T0.plusSeconds(26));
    assertThat(game.advance(T0.plusSeconds(35))).isFalse();
    assertThat(game.advance(T0.plusSeconds(36))).isTrue();
  }

  @Test
  void bleedoutReturnsOnlyAtTheNextRoundWithTheSameClass() {
    var game = started(true);
    game.down(ALICE, T0);
    assertThat(game.wiped()).isFalse();
    game.expire(T0.plusSeconds(29));
    assertThat(game.player(ALICE).orElseThrow().status()).isEqualTo(Survivor.Status.DOWNED);
    game.expire(T0.plusSeconds(30));
    assertThat(game.player(ALICE).orElseThrow().status()).isEqualTo(Survivor.Status.WAITING);
    game.cleared(T0.plusSeconds(31));
    assertThat(game.advance(T0.plusSeconds(38))).isFalse();
    assertThat(game.advance(T0.plusSeconds(39))).isTrue();
    assertThat(game.player(ALICE).orElseThrow().status()).isEqualTo(Survivor.Status.STANDING);
    assertThat(game.round()).isEqualTo(2);
  }

  @Test
  void aReviveMustBeUninterruptedForFiveSeconds() {
    var revival = new Revival();
    assertThat(revival.channel(BOB, ALICE, T0)).isFalse();
    assertThat(revival.channel(BOB, ALICE, T0.plusSeconds(4))).isFalse();
    revival.interrupt(BOB);
    assertThat(revival.channel(BOB, ALICE, T0.plusSeconds(5))).isFalse();
    assertThat(revival.channel(BOB, ALICE, T0.plusSeconds(10))).isTrue();
  }

  @Test
  void classesUnlockAtPersistentExperienceThresholds() {
    var game = new SurvivalGame();
    game.join(ALICE, "Alice", false);
    game.admitted(ALICE, false);
    assertThat(game.select(ALICE, SurvivalClass.ENGINEER, 499)).contains(GameError.CLASS_LOCKED);
    assertThat(game.select(ALICE, SurvivalClass.ENGINEER, 500)).isEmpty();
    assertThat(SurvivalClass.ALCHEMIST.unlocked(1499)).isFalse();
    assertThat(SurvivalClass.BEASTMASTER.unlocked(3000)).isTrue();
  }

  @Test
  void openingRoundsBuildPressureWithoutSwarmingAnUnequippedSoloPlayer() {
    var first = EncounterDirector.plan(1, 1, Set.of("gatehouse", "market"));
    assertThat(first.count()).isEqualTo(6);
    assertThat(first.concurrentLimit()).isEqualTo(3);
    assertThat(first.spawnBatch()).isEqualTo(1);
    assertThat(first.spawnIntervalSeconds()).isEqualTo(3);
    assertThat(first.roster()).containsExactly("zombie");
    assertThat(first.health()).isCloseTo(0.6, org.assertj.core.data.Offset.offset(0.001));
    assertThat(first.damage()).isEqualTo(0.5);
    for (var round = 2; round <= 3; round++) {
      var next = EncounterDirector.plan(round, 1, Set.of("gatehouse", "market"));
      assertThat(next.count()).isEqualTo(4 + round * 2);
      assertThat(next.concurrentLimit()).isLessThanOrEqualTo(5);
      assertThat(next.roster()).containsExactly("zombie", "husk");
      assertThat(next.health()).isLessThan(1);
      assertThat(next.damage()).isLessThan(1);
    }
    var coop = EncounterDirector.plan(1, 4, Set.of("gatehouse", "market"));
    assertThat(coop.count()).isEqualTo(15);
    assertThat(coop.concurrentLimit()).isEqualTo(9);
    assertThat(coop.spawnBatch()).isEqualTo(1);
  }

  @Test
  void endlesslyScaledEncountersRemainBoundedAndRespectLockedDistricts() {
    for (var round = 1; round <= 500; round++) {
      var encounter = EncounterDirector.plan(round, 4, Set.of("gatehouse", "market"));
      assertThat(encounter.count()).isBetween(1, 160);
      assertThat(encounter.damage()).isLessThanOrEqualTo(3);
      assertThat(encounter.event()).isNotEqualTo(EncounterDirector.Event.PALE_INCURSION);
      assertThat(encounter.boss()).isNotIn("heartwood", "warden");
      assertThat(encounter.boss().isEmpty()).isEqualTo(round % 5 != 0);
    }
  }

  @Test
  void aBossLocksAimBeforeImpactAndCanBeInterrupted() {
    var boss = new BossMechanics("warden", T0);
    assertThat(boss.begin(T0.plusSeconds(5), new Point(0, 73, 0), new Point(10, 73, 0), 0.5))
        .isTrue();
    var cast = boss.cast().orElseThrow();
    assertThat(cast.hits(new Point(10, 73, 0))).isTrue();
    assertThat(cast.hits(new Point(15, 73, 5))).isFalse();
    assertThat(boss.impact(T0.plusSeconds(7))).isEmpty();
    assertThat(boss.interrupt(T0.plusSeconds(7))).isTrue();
    assertThat(boss.impact(T0.plusSeconds(8))).isEmpty();
  }
}
