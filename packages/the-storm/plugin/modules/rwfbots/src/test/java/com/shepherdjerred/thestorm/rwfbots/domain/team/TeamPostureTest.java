package com.shepherdjerred.thestorm.rwfbots.domain.team;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.ArrayList;
import java.util.List;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

/** Three or more living teams wait, hunt the one smaller team, or press, and one bot may ignore it. */
final class TeamPostureTest {
  private static final TeamId GREEN = new TeamId("green");
  private static final Vec3 AT = new Vec3(9.5, 1, 24.5);

  @Test
  void theUniqueSmallerTeamIsTheWeakestAndTheSmallestDoesNotHunt() {
    var snapshot = world(false, List.of(squad(RED, 0, 2), squad(BLUE, 10, 5), squad(GREEN, 20, 5)));
    assertThat(TeamPosture.weakest(snapshot, BLUE)).contains(RED);
    assertThat(TeamPosture.weakest(snapshot, RED)).isEmpty();
    for (var seed = 0; seed < 40; seed++) {
      assertThat(roll(snapshot, RED, 0, 0, seed)).isNotEqualTo(Posture.HUNT_WEAKEST);
    }
    assertThat(rolls(snapshot, BLUE, 0, 0, 40)).contains(Posture.HUNT_WEAKEST);
  }

  @Test
  void tiedLargeTeamsOftenWaitAndPoisonOrTwoTeamsPress() {
    var even = world(false, List.of(squad(RED, 0, 4), squad(BLUE, 10, 4), squad(GREEN, 20, 4)));
    assertThat(TeamPosture.weakest(even, RED)).isEmpty();
    assertThat(rolls(even, RED, 0, 1, 40)).contains(Posture.WAIT);
    var poisoned = world(true, List.of(squad(RED, 0, 4), squad(BLUE, 10, 4), squad(GREEN, 20, 4)));
    assertThat(roll(poisoned, RED, 0, 1, 1)).isEqualTo(Posture.PRESS);
    var duel = world(false, List.of(squad(RED, 0, 4), squad(BLUE, 10, 4)));
    assertThat(roll(duel, RED, 1, 0, 1)).isEqualTo(Posture.PRESS);
  }

  @Test
  void whenEveryTeamWaitsTheMostAggressivePressesAndATieTakesTheLowestId() {
    var waiting =
        List.of(
            new TeamPosture.Choice(RED, Posture.WAIT, 0.2),
            new TeamPosture.Choice(BLUE, Posture.WAIT, 0.8),
            new TeamPosture.Choice(GREEN, Posture.WAIT, 0.8));
    var settled = TeamPosture.settle(waiting);
    assertThat(settled)
        .filteredOn(choice -> choice.team().equals(BLUE))
        .singleElement()
        .extracting(TeamPosture.Choice::posture)
        .isEqualTo(Posture.PRESS);
    assertThat(settled)
        .filteredOn(choice -> !choice.team().equals(BLUE))
        .allMatch(choice -> choice.posture() == Posture.WAIT);
    var mixed =
        List.of(
            new TeamPosture.Choice(RED, Posture.WAIT, 0.2),
            new TeamPosture.Choice(BLUE, Posture.PRESS, 0.9));
    assertThat(TeamPosture.settle(mixed)).isEqualTo(mixed);
  }

  @Test
  void aboutOneBotInFourIgnoresThePlanAndATeamOfOneDoesNot() {
    assertThat(TeamPosture.slackers(List.of(new TeamPosture.Fighter(new CombatantId(1), 0.9)), 1))
        .isEmpty();
    var pair =
        List.of(
            new TeamPosture.Fighter(new CombatantId(1), 0.2),
            new TeamPosture.Fighter(new CombatantId(2), 0.8));
    assertThat(TeamPosture.slackers(pair, 3)).hasSize(1);
    var calm = new CombatantId(1);
    var eager = new CombatantId(2);
    var fighters =
        List.of(
            new TeamPosture.Fighter(calm, 0.1),
            new TeamPosture.Fighter(eager, 0.95),
            new TeamPosture.Fighter(new CombatantId(3), 0.4),
            new TeamPosture.Fighter(new CombatantId(4), 0.4));
    var eagerPicks = 0;
    var calmPicks = 0;
    for (var seed = 0L; seed < 200; seed++) {
      var slack = TeamPosture.slackers(fighters, seed);
      assertThat(slack).hasSize(1);
      if (slack.contains(eager)) {
        eagerPicks++;
      }
      if (slack.contains(calm)) {
        calmPicks++;
      }
    }
    assertThat(eagerPicks).isGreaterThan(calmPicks);
  }

  private static Posture roll(
      WorldSnapshot snapshot, TeamId team, double aggression, double patience, long seed) {
    return TeamPosture.roll(snapshot, team, aggression, patience, new SplittableRandom(seed));
  }

  private static List<Posture> rolls(
      WorldSnapshot snapshot, TeamId team, double aggression, double patience, int seeds) {
    var drawn = new ArrayList<Posture>();
    for (var seed = 0; seed < seeds; seed++) {
      drawn.add(roll(snapshot, team, aggression, patience, seed));
    }
    return drawn;
  }

  private static WorldSnapshot world(boolean poison, List<List<CombatantView>> squads) {
    var views = new ArrayList<CombatantView>();
    for (var squad : squads) {
      views.addAll(squad);
    }
    return new WorldSnapshot(
        100,
        MatchPhase.LIVE,
        views,
        List.of(),
        poison ? PoisonView.startedAt(1, 1) : PoisonView.NONE,
        "yard",
        List.of(),
        List.of(),
        List.of());
  }

  private static List<CombatantView> squad(TeamId team, int start, int count) {
    var views = new ArrayList<CombatantView>();
    for (var i = 0; i < count; i++) {
      views.add(combatant(start + i, team, AT));
    }
    return views;
  }
}
