package com.shepherdjerred.thestorm.rwf.domain.match;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.poison.PoisonClock;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class RwfMatchSeedTest {

  @Test
  void reseedingPreservesTheEmptyLobbysIdentityMapAndRulesWithoutMutatingIt() {
    var play = new Play();
    play.ok(new MatchEvent.MapChosen(Samples.twoTeams()));
    var original = play.match;
    var seeded = original.reseedEmptyLobby(Long.MIN_VALUE);

    assertThat(seeded)
        .isEqualTo(
            new RwfMatch(
                original.settings(),
                original.matchId(),
                Long.MIN_VALUE,
                original.phase(),
                original.map(),
                original.members(),
                original.departed(),
                original.bombs()));
    assertThat(original.seed()).isEqualTo(Samples.SEED);
  }

  @Test
  void occupiedLobbiesAndEveryLaterPhaseRejectReseeding() {
    var play = new Play();
    play.join(Samples.ALICE);
    assertThatThrownBy(() -> play.match.reseedEmptyLobby(1))
        .isInstanceOf(IllegalStateException.class);

    var empty = new Play().match;
    List<Phase> phases =
        List.of(
            new Phase.Countdown(Samples.T0, Samples.T0, 0),
            new Phase.Live(
                Samples.T0, PoisonClock.start(Samples.T0), Samples.T0, Set.of(), Set.of()),
            new Phase.Ended(Samples.T0, new Outcome.Draw()),
            new Phase.Resetting());
    for (var phase : phases) {
      var match =
          new RwfMatch(
              empty.settings(),
              empty.matchId(),
              empty.seed(),
              phase,
              empty.map(),
              empty.members(),
              empty.departed(),
              empty.bombs());
      assertThatThrownBy(() -> match.reseedEmptyLobby(1))
          .as("cannot reseed %s", phase)
          .isInstanceOf(IllegalStateException.class);
    }
  }

  @Test
  void pairedSeedsRepeatLightingAndJoinOrderTeamAssignmentsWithFreshBodies() {
    for (long seed = 0; seed < 64; seed++) {
      var left = seeded(seed);
      var right = seeded(seed);
      var leftEffects = left.start(Samples.twoTeams(), Samples.ALICE, Samples.BOB);
      var rightEffects = right.start(Samples.twoTeams(), Samples.CAROL, Samples.DAVE);

      assertThat(teams(left)).isEqualTo(teams(right));
      assertThat(left.match.night()).isEqualTo(right.match.night());
      assertThat(leftEffects).contains(new MatchEffect.SetTime(left.match.startingWorldTime()));
      assertThat(rightEffects).contains(new MatchEffect.SetTime(left.match.startingWorldTime()));
    }
  }

  private static Play seeded(long seed) {
    var play = new Play();
    play.match = play.match.reseedEmptyLobby(seed);
    return play;
  }

  private static List<Optional<TeamColor>> teams(Play play) {
    return play.match.members().stream().map(Combatant::team).toList();
  }
}
