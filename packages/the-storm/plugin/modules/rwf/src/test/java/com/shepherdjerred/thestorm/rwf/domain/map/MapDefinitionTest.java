package com.shepherdjerred.thestorm.rwf.domain.map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.util.List;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

final class MapDefinitionTest {

  @Nested
  final class Validation {

    @Test
    void aMapNeedsAtLeastTwoTeams() {
      assertThatThrownBy(
              () ->
                  Samples.map(
                      List.of(Samples.red()),
                      List.of(Samples.teamBomb("red-1", TeamColor.RED, Samples.RED_BOMB))))
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessage("Not enough teams: 1");
    }

    @Test
    void aTeamMayNotBeListedTwice() {
      assertThatThrownBy(
              () ->
                  Samples.map(
                      List.of(Samples.red(), Samples.red()),
                      List.of(Samples.teamBomb("red-1", TeamColor.RED, Samples.RED_BOMB))))
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessageContaining("listed twice");
    }

    @Test
    void spawnsAndBombsStayInsideTheBorder() {
      assertThatThrownBy(
              () ->
                  Samples.map(
                      List.of(Samples.red(), Samples.team(TeamColor.BLUE, new BlockPos(60, 64, 0))),
                      List.of(
                          Samples.teamBomb("red-1", TeamColor.RED, Samples.RED_BOMB),
                          Samples.teamBomb("blue-1", TeamColor.BLUE, Samples.BLUE_BOMB))))
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessageContaining("spawn outside the border");
      assertThatThrownBy(
              () ->
                  Samples.map(
                      List.of(Samples.red(), Samples.blue()),
                      List.of(
                          Samples.teamBomb("red-1", TeamColor.RED, new BlockPos(0, 200, 0)),
                          Samples.teamBomb("blue-1", TeamColor.BLUE, Samples.BLUE_BOMB))))
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessage("bomb is outside the border: red-1");
    }

    @Test
    void everyTeamNeedsABombUnlessThereIsANuke() {
      assertThatThrownBy(
              () ->
                  Samples.map(
                      List.of(Samples.red(), Samples.blue()),
                      List.of(Samples.teamBomb("red-1", TeamColor.RED, Samples.RED_BOMB))))
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessage("Blue Team does not have a bomb set");

      var nuked =
          Samples.map(
              List.of(Samples.red(), Samples.blue()),
              List.of(
                  Samples.teamBomb("red-1", TeamColor.RED, Samples.RED_BOMB),
                  Samples.nuke("nuke-1", Samples.NUKE)));

      assertThat(nuked.hasNuke()).isTrue();
    }

    @Test
    void bombsBelongToFieldedTeamsAndAreUnique() {
      assertThatThrownBy(
              () ->
                  Samples.map(
                      List.of(Samples.red(), Samples.blue()),
                      List.of(
                          Samples.teamBomb("red-1", TeamColor.RED, Samples.RED_BOMB),
                          Samples.teamBomb("blue-1", TeamColor.BLUE, Samples.BLUE_BOMB),
                          Samples.teamBomb("green-1", TeamColor.GREEN, Samples.GREEN_BOMB))))
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessageContaining("does not field");
      assertThatThrownBy(
              () ->
                  Samples.map(
                      List.of(Samples.red(), Samples.blue()),
                      List.of(
                          Samples.teamBomb("red-1", TeamColor.RED, Samples.RED_BOMB),
                          Samples.teamBomb("red-1", TeamColor.BLUE, Samples.BLUE_BOMB))))
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessage("bomb id is used twice: red-1");
      assertThatThrownBy(
              () ->
                  Samples.map(
                      List.of(Samples.red(), Samples.blue()),
                      List.of(
                          Samples.teamBomb("red-1", TeamColor.RED, Samples.RED_BOMB),
                          Samples.teamBomb("blue-1", TeamColor.BLUE, Samples.RED_BOMB))))
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessageContaining("share a block");
    }

    @Test
    void idsAndHashesAreStrict() {
      assertThatThrownBy(() -> new BombSite("Red Bomb", new BombOwner.Nuke(), Samples.NUKE))
          .isInstanceOf(IllegalArgumentException.class);
      assertThatThrownBy(
              () ->
                  new MapDefinition(
                      "Harbour",
                      "Harbour",
                      "a",
                      List.of(Samples.red(), Samples.blue()),
                      List.of(Samples.nuke("nuke-1", Samples.NUKE)),
                      Samples.BORDER,
                      Samples.twoTeams().spectatorPoint(),
                      Samples.SHA))
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessageContaining("kebab-case");
      assertThatThrownBy(
              () ->
                  new MapDefinition(
                      "harbour",
                      "Harbour",
                      "a",
                      List.of(Samples.red(), Samples.blue()),
                      List.of(Samples.nuke("nuke-1", Samples.NUKE)),
                      Samples.BORDER,
                      Samples.twoTeams().spectatorPoint(),
                      "abc"))
          .isInstanceOf(IllegalArgumentException.class)
          .hasMessageContaining("hex");
    }

    @Test
    void aTeamNeedsASpawnAndTheBuilderWantedTwelve() {
      assertThatThrownBy(() -> new MapTeam(TeamColor.RED, List.of()))
          .isInstanceOf(IllegalArgumentException.class);
      assertThat(Samples.red().meetsBuilderSpawnMinimum()).isFalse();
      assertThat(MapTeam.BUILDER_MIN_SPAWNS).isEqualTo(12);
      assertThat(MapTeam.BUILDER_MAX_SPAWNS).isEqualTo(120);
    }

    @Test
    void lookupsFindTeamsAndBombs() {
      var map = Samples.twoTeamsWithNuke();

      assertThat(map.teamColors()).containsExactly(TeamColor.RED, TeamColor.BLUE);
      assertThat(map.team(TeamColor.GREEN)).isEmpty();
      assertThat(map.bomb("nuke-1")).isPresent();
      assertThat(map.bomb("nuke-1").orElseThrow().owner().team()).isEmpty();
      assertThat(map.bomb("red-1").orElseThrow().owner().team()).contains(TeamColor.RED);
    }
  }

  @Nested
  final class Rules {

    @Test
    void manyTeamMapsWaitForTwentyPlayers() {
      assertThat(MapRules.fitsPlayerCount(Samples.threeTeams(), 19)).isFalse();
      assertThat(MapRules.fitsPlayerCount(Samples.threeTeams(), 20)).isTrue();
      assertThat(MapRules.fitsPlayerCount(Samples.twoTeams(), 2)).isTrue();
    }

    @Test
    void theVoteWinnerYieldsToATwoTeamMapInASmallLobby() {
      var votes = List.of(Samples.threeTeams(), Samples.twoTeams());

      assertThat(MapRules.choose(votes, 8)).contains(Samples.twoTeams());
      assertThat(MapRules.choose(votes, 20)).contains(Samples.threeTeams());
      assertThat(MapRules.choose(List.of(Samples.threeTeams()), 8)).contains(Samples.threeTeams());
      assertThat(MapRules.choose(List.of(), 8)).isEmpty();
    }
  }
}
