package com.shepherdjerred.thestorm.rwf.domain.match;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.app.view.MatchState;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class PendingVictoryTest {
  private static Play match(boolean nuke) {
    var play = new Play();
    play.start(nuke ? Samples.twoTeamsWithNuke() : Samples.twoTeams(), Samples.ALICE, Samples.BOB);
    return play;
  }

  private static MatchState view(Play play) {
    return MatchState.of(MatchSnapshot.of(play.match, play.now));
  }

  private static void defuse(Play play, CombatantId player, String bomb) {
    for (var tick = 0; tick < 21 && play.match.phase() instanceof Phase.Live; tick++) {
      play.click(player, bomb);
      play.tickMillis(500);
    }
  }

  @Test
  void aLastSurvivingTeamMustDefuseItsOwnArmedBombBeforeWinning() {
    var play = match(false);
    var red = play.anyOn(TeamColor.RED).id();
    var blue = play.anyOn(TeamColor.BLUE).id();
    play.click(blue, "red-1");
    play.died(blue, Optional.of(red));
    assertThat(play.match.phase()).isInstanceOf(Phase.Live.class);
    assertThat(view(play).pendingElimination()).contains("red");
    defuse(play, red, "red-1");
    assertThat(play.match.phase()).isInstanceOf(Phase.Ended.class);
    assertThat(view(play).winner()).contains("red");
    assertThat(view(play).pendingElimination()).isEmpty();
  }

  @Test
  void aDeadPlantingTeamWinsWhenItsEnemyBombEliminatesTheLastOpposition() {
    var play = match(false);
    var blue = play.anyOn(TeamColor.BLUE).id();
    play.click(blue, "red-1");
    play.died(blue, Optional.empty());
    play.tick(60);
    assertThat(play.match.phase())
        .isEqualTo(new Phase.Ended(play.now, new Outcome.Winner(TeamColor.BLUE)));
    assertThat(view(play).combatants()).noneMatch(MatchState.Fighter::alive);
  }

  @Test
  void anEliminatedTeamsNukeRemainsArmedAndCanWinPosthumously() {
    var play = match(true);
    var blue = play.anyOn(TeamColor.BLUE).id();
    play.click(blue, "nuke-1");
    play.died(blue, Optional.empty());
    assertThat(play.match.bomb("nuke-1").orElseThrow().armed()).isTrue();
    assertThat(view(play).pendingElimination()).contains("red");
    play.tick(60);
    assertThat(view(play).winner()).contains("blue");
  }

  @Test
  void clearingAHostileNukeAwardsTheSurvivingTeam() {
    var play = match(true);
    var red = play.anyOn(TeamColor.RED).id();
    var blue = play.anyOn(TeamColor.BLUE).id();
    play.click(blue, "nuke-1");
    play.died(blue, Optional.empty());
    defuse(play, red, "nuke-1");
    assertThat(view(play).winner()).contains("red");
  }

  @Test
  void simultaneousConflictingDetonationsDrawRegardlessOfMapDeclarationOrder() {
    var normal = Samples.twoTeams();
    var reverse =
        new MapDefinition(
            normal.id(),
            normal.name(),
            normal.author(),
            normal.description(),
            normal.teams(),
            normal.bombs().reversed(),
            normal.border(),
            normal.spectatorPoint(),
            normal.blocksSha256());
    for (var map : List.of(normal, reverse)) {
      var play = new Play();
      play.start(map, Samples.ALICE, Samples.BOB);
      play.click(play.anyOn(TeamColor.BLUE).id(), "red-1");
      play.click(play.anyOn(TeamColor.RED).id(), "blue-1");
      var effects = play.tick(60);
      assertThat(effects.stream().filter(MatchEffect.Explode.class::isInstance)).hasSize(2);
      assertThat(play.match.phase()).isEqualTo(new Phase.Ended(play.now, new Outcome.Draw()));
    }
  }

  @Test
  void aSurvivingTeamsOwnNukeDoesNotDelayAnOtherwiseDecidedVictory() {
    var play = match(true);
    var red = play.anyOn(TeamColor.RED).id();
    var blue = play.anyOn(TeamColor.BLUE).id();
    play.click(red, "nuke-1");
    play.died(blue, Optional.empty());
    assertThat(view(play).winner()).contains("red");
    assertThat(view(play).pendingElimination()).isEmpty();
  }
}
