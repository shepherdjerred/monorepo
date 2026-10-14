package com.shepherdjerred.thestorm.rwf.domain.match;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.BOB;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.BOT_1;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.BOT_2;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.CAROL;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.DAVE;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.ERIN;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.FRANK;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.killstreak.Killstreak;
import com.shepherdjerred.thestorm.rwf.domain.killstreak.StreakLoadout;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** The match hands out killstreak rewards as kills and assists climb, as Red Warfare did. */
final class KillstreakMatchTest {

  private static List<MatchEffect.KillstreakEarned> streaks(List<MatchEffect> effects) {
    return effects.stream()
        .filter(MatchEffect.KillstreakEarned.class::isInstance)
        .map(MatchEffect.KillstreakEarned.class::cast)
        .toList();
  }

  private static Play eightAside() {
    var play = new Play(Play.FLOW, Samples.T0);
    play.start(Samples.twoTeams(), ALICE, BOB, CAROL, DAVE, ERIN, FRANK, BOT_1, BOT_2);
    return play;
  }

  private static List<CombatantId> enemies(Play play) {
    var team = play.teamOf(ALICE);
    return play.match.members().stream()
        .filter(member -> !member.onTeam(team))
        .map(Combatant::id)
        .toList();
  }

  private static CombatantId teammate(Play play) {
    var team = play.teamOf(ALICE);
    return play.match.members().stream()
        .filter(member -> member.onTeam(team) && !member.id().equals(ALICE))
        .findFirst()
        .orElseThrow()
        .id();
  }

  @Test
  void theSecondKillEarnsTheCompass() {
    var play = eightAside();
    var enemies = enemies(play);

    assertThat(streaks(play.died(enemies.get(0), Optional.of(ALICE)))).isEmpty();
    var second = play.died(enemies.get(1), Optional.of(ALICE));

    assertThat(streaks(second))
        .containsExactly(
            new MatchEffect.KillstreakEarned(ALICE, new Killstreak.Earned(Killstreak.COMPASS, 2)));
  }

  @Test
  void assistsCountTheirShareTowardsTheStreak() {
    var play = eightAside();
    var enemies = enemies(play);
    var friend = teammate(play);

    play.died(enemies.get(0), Optional.of(ALICE));
    play.hurt(enemies.get(1), ALICE, 5, 20);
    play.hurt(enemies.get(1), friend, 5, 15);
    assertThat(streaks(play.died(enemies.get(1), Optional.of(friend)))).isEmpty();
    play.hurt(enemies.get(2), ALICE, 5, 20);
    play.hurt(enemies.get(2), friend, 5, 15);
    var third = play.died(enemies.get(2), Optional.of(friend));

    assertThat(play.member(ALICE).score().killstreak()).isEqualTo(2.0);
    assertThat(streaks(third))
        .contains(
            new MatchEffect.KillstreakEarned(ALICE, new Killstreak.Earned(Killstreak.COMPASS, 2)));
  }

  @Test
  void aDeadCombatantEarnsNothing() {
    var play = eightAside();
    var enemies = enemies(play);
    var friend = teammate(play);

    play.died(enemies.get(0), Optional.of(friend));
    play.hurt(enemies.get(1), friend, 10, 20);
    play.died(friend, Optional.of(enemies.get(2)));
    assertThat(play.member(friend).score().killstreak()).isZero();
    play.hurt(enemies.get(1), ALICE, 10, 10);
    var effects = play.died(enemies.get(1), Optional.of(ALICE));

    assertThat(streaks(effects))
        .extracting(MatchEffect.KillstreakEarned::id)
        .doesNotContain(friend);
    assertThat(play.member(friend).score().killstreak()).isZero();
    assertThat(play.member(friend).score().kills()).isEqualTo(1);
    assertThat(play.member(friend).score().assists()).isEqualTo(1);
  }

  @Test
  void aPosthumousKillUpdatesTotalsWithoutRestartingTheDeadLifeStreak() {
    var play = eightAside();
    var opponents = enemies(play);
    var friend = teammate(play);
    play.died(opponents.get(0), Optional.of(friend));
    play.died(friend, Optional.of(opponents.get(2)));
    var late = play.died(opponents.get(1), Optional.of(friend));
    assertThat(play.member(friend).score().kills()).isEqualTo(2);
    assertThat(play.member(friend).score().killstreak()).isZero();
    assertThat(streaks(late)).extracting(MatchEffect.KillstreakEarned::id).doesNotContain(friend);
    var nextLife = play.member(friend).carried(play.now.plusSeconds(30));
    assertThat(nextLife.score()).isEqualTo(Score.ZERO);
    assertThat(nextLife.streaks()).isEqualTo(play.member(friend).streaks());
  }

  @Test
  void selectedWolvesReplaceTheCrateAndFreezeWithTheSameWindowAsKits() {
    var play = new Play(Play.FLOW, Samples.T0);
    for (var player : List.of(ALICE, BOB, CAROL, DAVE, ERIN, FRANK, BOT_1, BOT_2))
      play.join(player);
    var choices =
        new StreakLoadout(List.of(Killstreak.COMPASS, Killstreak.WOLVES, Killstreak.NAPALM));
    play.ok(new MatchEvent.PickStreaks(ALICE, choices));
    play.ballot(Samples.twoTeams());
    play.ok(new MatchEvent.ForceStart(play.now));
    play.ready(Samples.twoTeams());
    assertThat(play.refused(new MatchEvent.PickStreaks(ALICE, StreakLoadout.DEFAULT)))
        .isEqualTo(MatchError.NOT_PRE_GAME);
    var opponents = enemies(play);
    for (var i = 0; i < 3; i++) play.died(opponents.get(i), Optional.of(ALICE));
    assertThat(streaks(play.died(opponents.get(3), Optional.of(ALICE))))
        .containsExactly(
            new MatchEffect.KillstreakEarned(ALICE, new Killstreak.Earned(Killstreak.WOLVES, 4)));
  }
}
