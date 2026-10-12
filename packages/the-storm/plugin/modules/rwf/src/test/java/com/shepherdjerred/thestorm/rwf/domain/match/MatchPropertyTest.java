package com.shepherdjerred.thestorm.rwf.domain.match;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwf.domain.bomb.Bomb;
import com.shepherdjerred.thestorm.rwf.domain.bomb.BombState;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.util.List;
import java.util.Optional;
import java.util.SplittableRandom;
import java.util.random.RandomGenerator;
import org.junit.jupiter.api.Test;

/**
 * Random event streams against a three-team match, checking the invariants that must hold whatever
 * happens: at most one winner, no living member on a defeated team, and an armed bomb always has
 * between one and sixty seconds left.
 */
final class MatchPropertyTest {

  private static final List<CombatantId> PLAYERS =
      List.of(Samples.ALICE, Samples.BOB, Samples.CAROL, Samples.DAVE, Samples.ERIN, Samples.FRANK);
  private static final List<String> BOMBS = List.of("red-1", "blue-1", "green-1");

  @Test
  void invariantsHoldAcrossRandomMatches() {
    for (var seed = 1; seed <= 40; seed++) {
      var random = new SplittableRandom(seed);
      var play = new Play();
      play.start(Samples.threeTeams(), PLAYERS.toArray(CombatantId[]::new));
      for (var step = 0; step < 400 && play.match.phase() instanceof Phase.Live; step++) {
        apply(play, random);
        check(play.match, "seed " + seed + " step " + step);
      }
      drain(play);
      check(play.match, "seed " + seed + " drained");
    }
  }

  private static void apply(Play play, RandomGenerator random) {
    var roll = random.nextInt(100);
    if (roll < 45) {
      play.tickMillis(250 + random.nextInt(1500));
    } else if (roll < 85) {
      var who = PLAYERS.get(random.nextInt(PLAYERS.size()));
      var bomb = BOMBS.get(random.nextInt(BOMBS.size()));
      attempt(play, new MatchEvent.BombClicked(who, bomb, play.now));
    } else if (roll < 95) {
      var victim = PLAYERS.get(random.nextInt(PLAYERS.size()));
      var killer = PLAYERS.get(random.nextInt(PLAYERS.size()));
      play.ok(new MatchEvent.Died(victim, Optional.of(killer), AttackType.MELEE, play.now));
    } else {
      var who = PLAYERS.get(random.nextInt(PLAYERS.size()));
      attempt(play, new MatchEvent.Leave(who, play.now));
    }
  }

  /** Applies an event the match may legitimately refuse. */
  private static void attempt(Play play, MatchEvent event) {
    switch (play.match.on(event)) {
      case Result.Ok<RwfMatch.Step, MatchError>(var step) -> play.match = step.match();
      case Result.Err<RwfMatch.Step, MatchError> _ -> {}
    }
  }

  /** Ticks until the match is over or the poison has had time to end it. */
  private static void drain(Play play) {
    for (var i = 0; i < 1200 && play.match.phase() instanceof Phase.Live; i++) {
      play.tick(1);
    }
  }

  private static void check(RwfMatch match, String where) {
    switch (match.phase()) {
      case Phase.Live live -> {
        for (var member : match.members()) {
          if (member.alive()) {
            assertThat(live.defeated())
                .as("%s: living %s on a defeated team", where, member.id())
                .doesNotContain(member.team().orElseThrow());
          }
        }
      }
      case Phase.Ended ended ->
          assertThat(
                  ended.outcome().winner().isPresent() || ended.outcome() instanceof Outcome.Draw)
              .as("%s: an ended match has one winner or is a draw", where)
              .isTrue();
      default -> {}
    }
    for (Bomb bomb : match.bombs()) {
      if (bomb.state() instanceof BombState.Armed armed) {
        assertThat(armed.remaining())
            .as("%s: %s", where, bomb.id())
            .isBetween(1, Bomb.FUSE_SECONDS);
      }
    }
  }
}
