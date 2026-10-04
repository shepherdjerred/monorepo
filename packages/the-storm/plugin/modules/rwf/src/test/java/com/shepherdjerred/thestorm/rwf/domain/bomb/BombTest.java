package com.shepherdjerred.thestorm.rwf.domain.bomb;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.BOB;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.CAROL;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.DAVE;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.T0;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwf.domain.bomb.BombState.Armed;
import com.shepherdjerred.thestorm.rwf.domain.bomb.BombState.Idle;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

final class BombTest {

  private static final Optional<FuseBonus> PLAIN = Optional.empty();

  private Bomb redBomb = Bomb.at(Samples.teamBomb("red-1", TeamColor.RED, Samples.RED_BOMB));
  private Bomb nuke = Bomb.at(Samples.nuke("nuke-1", Samples.NUKE));
  private Instant now = T0;

  private static BombClick click(CombatantId who, TeamColor team, Instant at) {
    return new BombClick(who, team, PLAIN, at);
  }

  private static ArmAttempt onlyAttempt(Bomb bomb) {
    assertThat(bomb.state().attempts()).hasSize(1);
    return bomb.state().attempts().getFirst();
  }

  private static Bomb.Step ok(Result<Bomb.Step, BombError> result) {
    return result.fold(
        step -> step,
        error -> {
          throw new AssertionError("refused: " + error);
        });
  }

  private static BombError refused(Result<Bomb.Step, BombError> result) {
    return result.fold(
        step -> {
          throw new AssertionError("accepted: " + step);
        },
        error -> error);
  }

  /**
   * The clickers click every half second until {@code seconds} have passed or a click arms or
   * defuses the bomb (leaving {@code now} at that click), then one tick.
   */
  private Bomb spam(Bomb bomb, List<BombClick> clickers, double seconds) {
    var current = bomb;
    var wasArmed = current.armed();
    var end = now.plusMillis((long) (seconds * 1000));
    while (!now.isAfter(end)) {
      for (var template : clickers) {
        current =
            ok(current.click(
                    new BombClick(template.clicker(), template.team(), template.fuse(), now)))
                .bomb();
      }
      if (current.armed() != wasArmed) {
        return current;
      }
      now = now.plusMillis(500);
    }
    return current.tick(now).bomb();
  }

  @Nested
  final class Arming {

    @Test
    void oneClickerNeedsNineSeconds() {
      var bomb = ok(redBomb.click(click(ALICE, TeamColor.BLUE, now))).bomb();

      var attempt = onlyAttempt(bomb);
      assertThat(attempt.secondsToFuse()).isEqualTo(9);
      assertThat(attempt.finishesAt()).isEqualTo(now.plusSeconds(9));
      assertThat(attempt.clickers()).containsExactly(ALICE);
      assertThat(bomb.armed()).isFalse();
    }

    @Test
    void everyDistinctClickerOnTheTeamTakesASecondOff() {
      var bomb = ok(redBomb.click(click(ALICE, TeamColor.BLUE, now))).bomb();
      bomb = ok(bomb.click(click(BOB, TeamColor.BLUE, now))).bomb();
      bomb = ok(bomb.click(click(CAROL, TeamColor.BLUE, now))).bomb();
      bomb = ok(bomb.click(click(ALICE, TeamColor.BLUE, now))).bomb();

      assertThat(onlyAttempt(bomb).secondsToFuse()).isEqualTo(7);
      assertThat(onlyAttempt(bomb).clickers()).containsExactly(ALICE, BOB, CAROL);
    }

    @Test
    void fuseBonusesCountOnlyForTheirAction() {
      var speed = Optional.of(new FuseBonus(FuseType.BOMB_SPEED, 2));
      var arming = Optional.of(new FuseBonus(FuseType.BOMB_ARMING, 3));
      var defusing = Optional.of(new FuseBonus(FuseType.BOMB_DEFUSING, 3));

      assertThat(seconds(redBomb, speed)).isEqualTo(7);
      assertThat(seconds(redBomb, arming)).isEqualTo(6);
      assertThat(seconds(redBomb, defusing)).isEqualTo(9);
    }

    private int seconds(Bomb bomb, Optional<FuseBonus> fuse) {
      return onlyAttempt(ok(bomb.click(new BombClick(ALICE, TeamColor.BLUE, fuse, now))).bomb())
          .secondsToFuse();
    }

    @Test
    void bombArmingTenArmsOnTheClick() {
      var instant = Optional.of(new FuseBonus(FuseType.BOMB_ARMING, FuseBonus.INSTANT));

      var step = ok(redBomb.click(new BombClick(ALICE, TeamColor.BLUE, instant, now)));

      assertThat(step.outcomes())
          .containsExactly(new BombOutcome.Armed(TeamColor.BLUE, List.of(ALICE)));
      assertThat(step.bomb().state()).isEqualTo(new Armed(TeamColor.RED, now, 60, List.of()));
    }

    @Test
    void aPauseLongerThanTheClickGapStartsOver() {
      var bomb = ok(redBomb.click(click(ALICE, TeamColor.BLUE, now))).bomb();
      bomb = ok(bomb.click(click(ALICE, TeamColor.BLUE, now.plusMillis(750)))).bomb();
      assertThat(onlyAttempt(bomb).startedAt()).isEqualTo(now);

      bomb = ok(bomb.click(click(ALICE, TeamColor.BLUE, now.plusMillis(1501)))).bomb();

      assertThat(onlyAttempt(bomb).startedAt()).isEqualTo(now.plusMillis(1501));
      assertThat(onlyAttempt(bomb).finishesAt()).isEqualTo(now.plusMillis(1501).plusSeconds(9));
    }

    @Test
    void anAbandonedAttemptLapsesOnTick() {
      var bomb = ok(redBomb.click(click(ALICE, TeamColor.BLUE, now))).bomb();

      assertThat(bomb.tick(now.plusMillis(750)).bomb().state().attempts()).hasSize(1);
      assertThat(bomb.tick(now.plusMillis(751)).bomb().state()).isEqualTo(Idle.EMPTY);
    }

    @Test
    void keepingTheFuseOnArmsTheBomb() {
      var bomb = spam(redBomb, List.of(click(ALICE, TeamColor.BLUE, now)), 9.5);

      assertThat(bomb.armed()).isTrue();
      assertThat(bomb.team()).contains(TeamColor.RED);
      assertThat(((Armed) bomb.state()).remaining()).isEqualTo(60);
    }

    @Test
    void theEarliestFinisherWinsWhenTeamsCompete() {
      var late = now.plusSeconds(1);
      var bomb = nuke;
      var blue = click(ALICE, TeamColor.BLUE, now);
      var greens =
          List.of(
              click(BOB, TeamColor.GREEN, late),
              click(CAROL, TeamColor.GREEN, late),
              click(DAVE, TeamColor.GREEN, late));
      bomb = spam(bomb, List.of(blue), 0.5);
      var outcomes = new ArrayList<BombOutcome>();
      while (!bomb.armed()) {
        for (var template : List.of(blue, greens.get(0), greens.get(1), greens.get(2))) {
          if (bomb.armed()) {
            break;
          }
          var step = ok(bomb.click(new BombClick(template.clicker(), template.team(), PLAIN, now)));
          bomb = step.bomb();
          outcomes.addAll(step.outcomes());
        }
        now = now.plusMillis(500);
      }

      assertThat(outcomes)
          .containsExactly(new BombOutcome.Armed(TeamColor.GREEN, List.of(BOB, CAROL, DAVE)));
      assertThat(bomb.team()).contains(TeamColor.GREEN);
    }
  }

  @Nested
  final class Refusing {

    @Test
    void ownersCannotArmAndEnemiesCannotDefuse() {
      assertThat(refused(redBomb.click(click(ALICE, TeamColor.RED, now))))
          .isEqualTo(BombError.CANNOT_ARM_OWN_BOMB);

      var armed = spam(redBomb, List.of(click(ALICE, TeamColor.BLUE, now)), 9.5);

      assertThat(refused(armed.click(click(ALICE, TeamColor.BLUE, now))))
          .isEqualTo(BombError.CANNOT_DEFUSE_ENEMY_BOMB);
      ok(armed.click(click(BOB, TeamColor.RED, now)));
    }

    @Test
    void aNukeIsAnyonesUntilArmedAndThenNotItsArmers() {
      ok(nuke.click(click(ALICE, TeamColor.RED, now)));
      var armed = spam(nuke, List.of(click(ALICE, TeamColor.RED, now)), 9.5);

      assertThat(armed.team()).contains(TeamColor.RED);
      assertThat(refused(armed.click(click(BOB, TeamColor.RED, now))))
          .isEqualTo(BombError.CANNOT_DEFUSE_OWN_NUKE);
      ok(armed.click(click(CAROL, TeamColor.BLUE, now)));
    }

    @Test
    void aDestroyedBombRefusesEverything() {
      assertThat(refused(redBomb.destroy().click(click(ALICE, TeamColor.BLUE, now))))
          .isEqualTo(BombError.DESTROYED);
      assertThat(redBomb.destroy().tick(now).outcomes()).isEmpty();
    }
  }

  @Nested
  final class Burning {

    @Test
    void theFuseBurnsASecondAtATimeAndAnnouncesTheEnd() {
      var bomb = spam(redBomb, List.of(click(ALICE, TeamColor.BLUE, now)), 9.5);
      var fusedAt = now;
      var outcomes = new ArrayList<BombOutcome>();
      for (var k = 1; k <= 60; k++) {
        var step = bomb.tick(fusedAt.plusSeconds(k));
        bomb = step.bomb();
        outcomes.addAll(step.outcomes());
      }

      var announced =
          outcomes.stream()
              .filter(BombOutcome.Burned.class::isInstance)
              .map(BombOutcome.Burned.class::cast)
              .filter(BombOutcome.Burned::announced)
              .map(BombOutcome.Burned::remaining)
              .toList();
      assertThat(announced).containsExactly(30, 20, 10, 5, 4, 3, 2, 1);
      assertThat(outcomes).filteredOn(BombOutcome.Burned.class::isInstance).hasSize(60);
      assertThat(outcomes.getLast()).isEqualTo(new BombOutcome.Exploded());
      assertThat(((Armed) bomb.state()).remaining()).isZero();
    }

    @Test
    void theFirstSecondBurnsOnTheFirstTickAfterArming() {
      var bomb = spam(redBomb, List.of(click(ALICE, TeamColor.BLUE, now)), 9.5);

      var step = bomb.tick(now.plusMillis(1));

      assertThat(step.outcomes()).containsExactly(new BombOutcome.Burned(59, false));
      assertThat(bomb.tick(now.plusSeconds(59).plusMillis(1)).outcomes())
          .endsWith(new BombOutcome.Exploded());
    }

    @Test
    void defusingRestoresTheBlockAndResetsTheFuse() {
      var bomb = spam(redBomb, List.of(click(ALICE, TeamColor.BLUE, now)), 9.5);
      bomb = bomb.tick(now.plusSeconds(10)).bomb();
      now = now.plusSeconds(10);
      assertThat(((Armed) bomb.state()).remaining()).isEqualTo(50);

      var start = now;
      var outcomes = new ArrayList<BombOutcome>();
      while (!now.isAfter(start.plusMillis(9500))) {
        var step = ok(bomb.click(click(BOB, TeamColor.RED, now)));
        bomb = step.bomb();
        outcomes.addAll(step.outcomes());
        now = now.plusMillis(500);
      }

      assertThat(outcomes).containsExactly(new BombOutcome.Defused(TeamColor.RED, List.of(BOB)));
      assertThat(bomb.state()).isEqualTo(Idle.EMPTY);
      var rearmed = spam(bomb, List.of(click(ALICE, TeamColor.BLUE, now)), 9.5);
      assertThat(((Armed) rearmed.state()).remaining()).isEqualTo(60);
    }

    @Test
    void restoringANukeForgetsItsTeam() {
      var armed = spam(nuke, List.of(click(ALICE, TeamColor.RED, now)), 9.5);

      assertThat(armed.restore().team()).isEmpty();
      assertThat(nuke.restore()).isEqualTo(nuke);
    }
  }
}
