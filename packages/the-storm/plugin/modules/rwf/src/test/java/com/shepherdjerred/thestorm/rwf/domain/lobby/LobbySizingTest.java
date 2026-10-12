package com.shepherdjerred.thestorm.rwf.domain.lobby;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwf.testing.Samples;
import org.junit.jupiter.api.Test;

final class LobbySizingTest {
  @Test
  void teamOverridesFollowTheMapTeamCountAndRespectTheCap() {
    var selection = new LobbySizing.Selection(LobbySizing.Mode.TEAM, 8);
    assertThat(selection.target(Samples.twoTeams(), 100)).isEqualTo(16);
    assertThat(selection.target(Samples.threeTeams(), 100)).isEqualTo(24);
    assertThat(selection.target(Samples.threeTeams(), 20)).isEqualTo(18);
    assertThat(
            new LobbySizing.Selection(LobbySizing.Mode.TEAM, Integer.MAX_VALUE)
                .target(Samples.threeTeams(), 100))
        .isEqualTo(99);
  }

  @Test
  void explicitFixedTargetsRetainDuelCountsAndOddRosters() {
    assertThat(new LobbySizing.Selection(LobbySizing.Mode.FIXED, 2).target(Samples.twoTeams(), 2))
        .isEqualTo(2);
    assertThat(new LobbySizing.Selection(LobbySizing.Mode.FIXED, 7).target(Samples.twoTeams(), 100))
        .isEqualTo(7);
  }

  @Test
  void aCapThatCannotFieldEveryTeamIsRejected() {
    assertThatThrownBy(() -> LobbySizing.recommend(Samples.threeTeams(), 2))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new LobbySizing.Selection(LobbySizing.Mode.TEAM, 0))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
